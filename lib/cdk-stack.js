"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CdkStack = void 0;
const path = require("path");
const cdk = require("aws-cdk-lib");
const cognito = require("aws-cdk-lib/aws-cognito");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const events = require("aws-cdk-lib/aws-events");
const lambda = require("aws-cdk-lib/aws-lambda");
const lambdaNodejs = require("aws-cdk-lib/aws-lambda-nodejs");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const sqs = require("aws-cdk-lib/aws-sqs");
const targets = require("aws-cdk-lib/aws-events-targets");
const lambdaEventSources = require("aws-cdk-lib/aws-lambda-event-sources");
const iam = require("aws-cdk-lib/aws-iam");
const s3assets = require("aws-cdk-lib/aws-s3-assets");
const sagemaker = require("aws-cdk-lib/aws-sagemaker");
// impports para frontend y s3 este codigo no es autogenerado
const s3 = require("aws-cdk-lib/aws-s3");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const origins = require("aws-cdk-lib/aws-cloudfront-origins");
const s3deploy = require("aws-cdk-lib/aws-s3-deployment");
class CdkStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const eventBus = new events.EventBus(this, "AirbnbEventBus");
        // Modelo academico K-Means: CDK publica model.tar.gz en su bucket de assets.
        const modelArchivePath = process.env.ML_MODEL_ARCHIVE ?? path.resolve(__dirname, "../../../MLOps/protecto_modulo_15/models/model.tar.gz");
        const modelAsset = new s3assets.Asset(this, "KMeansModelAsset", {
            path: modelArchivePath
        });
        const sageMakerRole = new iam.Role(this, "SageMakerExecutionRole", {
            assumedBy: new iam.ServicePrincipal("sagemaker.amazonaws.com"),
            inlinePolicies: {
                ModelAssetRead: new iam.PolicyDocument({
                    statements: [new iam.PolicyStatement({
                            actions: ["s3:GetObject", "s3:GetObjectVersion"],
                            resources: [`${modelAsset.bucket.bucketArn}/${modelAsset.s3ObjectKey}`]
                        })]
                })
            }
        });
        const sageMakerModel = new sagemaker.CfnModel(this, "KMeansSageMakerModel", {
            executionRoleArn: sageMakerRole.roleArn,
            primaryContainer: {
                image: cdk.Fn.sub("257758044811.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/sagemaker-scikit-learn:1.2-1-cpu-py3"),
                modelDataUrl: modelAsset.s3ObjectUrl,
                environment: {
                    SAGEMAKER_PROGRAM: "inference.py",
                    SAGEMAKER_SUBMIT_DIRECTORY: "/opt/ml/model/code"
                }
            }
        });
        const sageMakerEndpointConfig = new sagemaker.CfnEndpointConfig(this, "KMeansEndpointConfig", {
            productionVariants: [{
                    modelName: sageMakerModel.attrModelName,
                    variantName: "AllTraffic",
                    serverlessConfig: {
                        memorySizeInMb: 1024,
                        maxConcurrency: 2
                    }
                }]
        });
        const sageMakerEndpoint = new sagemaker.CfnEndpoint(this, "KMeansEndpoint", {
            endpointConfigName: sageMakerEndpointConfig.attrEndpointConfigName
        });
        const notificationDlq = new sqs.Queue(this, "NotificationDLQ", {
            retentionPeriod: cdk.Duration.days(14),
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        const notificationQueue = new sqs.Queue(this, "NotificationQueue", {
            visibilityTimeout: cdk.Duration.seconds(60),
            retentionPeriod: cdk.Duration.days(4),
            deadLetterQueue: {
                queue: notificationDlq,
                maxReceiveCount: 3
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        new events.Rule(this, "NotificationEventsRule", {
            eventBus,
            eventPattern: {
                source: [
                    "auth.service",
                    "user.service",
                    "listing.service",
                    "booking.service",
                    "review.service"
                ],
                detailType: [
                    "user.created",
                    "listing.created",
                    "booking.created",
                    "review.created"
                ]
            },
            targets: [new targets.SqsQueue(notificationQueue)]
        });
        // Cognito User Pool
        const userPool = new cognito.UserPool(this, "UserPool", {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            selfSignUpEnabled: true,
            signInAliases: { email: true },
            autoVerify: { email: true },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true
            },
            customAttributes: {
                role: new cognito.StringAttribute({ mutable: true })
            }
        });
        // Cognito App Client
        const userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
            userPool,
            authFlows: {
                userPassword: true,
                userSrp: true
            }
        });
        // DynamoDB Table
        const usersTable = new dynamodb.Table(this, "UsersTable", {
            partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        const listingsTable = new dynamodb.Table(this, "ListingsTable", {
            partitionKey: { name: "listingId", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        listingsTable.addGlobalSecondaryIndex({
            indexName: "ownerId-index",
            partitionKey: { name: "ownerId", type: dynamodb.AttributeType.STRING }
        });
        const bookingsTable = new dynamodb.Table(this, "BookingsTable", {
            partitionKey: { name: "bookingId", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        bookingsTable.addGlobalSecondaryIndex({
            indexName: "guestId-index",
            partitionKey: { name: "guestId", type: dynamodb.AttributeType.STRING }
        });
        bookingsTable.addGlobalSecondaryIndex({
            indexName: "listingId-index",
            partitionKey: { name: "listingId", type: dynamodb.AttributeType.STRING }
        });
        const reviewsTable = new dynamodb.Table(this, "ReviewsTable", {
            partitionKey: { name: "reviewId", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        const notificationsTable = new dynamodb.Table(this, "NotificationsTable", {
            partitionKey: { name: "notificationId", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        reviewsTable.addGlobalSecondaryIndex({
            indexName: "listingId-index",
            partitionKey: { name: "listingId", type: dynamodb.AttributeType.STRING }
        });
        // Lambda
        const servicesRoot = path.join(__dirname, "../../airbnb_group_services");
        const frontendUrl = process.env.FRONTEND_URL;
        const authRegisterLambda = new lambdaNodejs.NodejsFunction(this, "AuthRegisterLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/auth-service/src/handler.ts"),
            handler: "register",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                FRONTEND_URL: frontendUrl
            }
        });
        const authConfirmLambda = new lambdaNodejs.NodejsFunction(this, "AuthConfirmLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/auth-service/src/handler.ts"),
            handler: "confirm",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                USER_POOL_ID: userPool.userPoolId,
                USERS_TABLE: usersTable.tableName,
                EVENT_BUS_NAME: eventBus.eventBusName,
                FRONTEND_URL: frontendUrl
            }
        });
        const authLoginLambda = new lambdaNodejs.NodejsFunction(this, "AuthLoginLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/auth-service/src/handler.ts"),
            handler: "login",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                USER_POOL_ID: userPool.userPoolId,
                USERS_TABLE: usersTable.tableName,
                FRONTEND_URL: frontendUrl
            }
        });
        const authRefreshLambda = new lambdaNodejs.NodejsFunction(this, "AuthRefreshLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/auth-service/src/handler.ts"),
            handler: "refresh",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                USERS_TABLE: usersTable.tableName,
                FRONTEND_URL: frontendUrl
            }
        });
        const authLogoutLambda = new lambdaNodejs.NodejsFunction(this, "AuthLogoutLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/auth-service/src/handler.ts"),
            handler: "logout",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                FRONTEND_URL: frontendUrl
            }
        });
        const userLambda = new lambdaNodejs.NodejsFunction(this, "UserLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/user-service/src/handler.ts"),
            handler: "createUser",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                USERS_TABLE: usersTable.tableName,
                EVENT_BUS_NAME: eventBus.eventBusName,
                FRONTEND_URL: frontendUrl
            }
        });
        const listingLambda = new lambdaNodejs.NodejsFunction(this, "ListingLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/listing-service/src/handler.ts"),
            handler: "createListing",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                LISTINGS_TABLE: listingsTable.tableName,
                EVENT_BUS_NAME: eventBus.eventBusName,
                FRONTEND_URL: frontendUrl
            }
        });
        const getListingsLambda = new lambdaNodejs.NodejsFunction(this, "GetListingsLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/listing-service/src/handler.ts"),
            handler: "getListingsByOwner",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                LISTINGS_TABLE: listingsTable.tableName,
                FRONTEND_URL: frontendUrl
            }
        });
        const getAllListingsLambda = new lambdaNodejs.NodejsFunction(this, "GetAllListingsLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/listing-service/src/handler.ts"),
            handler: "getAllListings",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                LISTINGS_TABLE: listingsTable.tableName,
                FRONTEND_URL: frontendUrl
            }
        });
        const bookingLambda = new lambdaNodejs.NodejsFunction(this, "BookingLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/booking-service/src/handler.ts"),
            handler: "createBooking",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                BOOKINGS_TABLE: bookingsTable.tableName,
                EVENT_BUS_NAME: eventBus.eventBusName,
                FRONTEND_URL: frontendUrl
            }
        });
        const getBookingsLambda = new lambdaNodejs.NodejsFunction(this, "GetBookingsLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/booking-service/src/handler.ts"),
            handler: "getBookingsByGuest",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                BOOKINGS_TABLE: bookingsTable.tableName,
                FRONTEND_URL: frontendUrl
            }
        });
        const getBookingsByListingLambda = new lambdaNodejs.NodejsFunction(this, "GetBookingsByListingLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/booking-service/src/handler.ts"),
            handler: "getBookingsByListing",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                BOOKINGS_TABLE: bookingsTable.tableName,
                FRONTEND_URL: frontendUrl
            }
        });
        const getBookingLambda = new lambdaNodejs.NodejsFunction(this, "GetBookingLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/booking-service/src/handler.ts"),
            handler: "getBookingById",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                BOOKINGS_TABLE: bookingsTable.tableName,
                FRONTEND_URL: frontendUrl
            }
        });
        const reviewLambda = new lambdaNodejs.NodejsFunction(this, "ReviewLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/review-service/src/handler.ts"),
            handler: "createReview",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                REVIEWS_TABLE: reviewsTable.tableName,
                EVENT_BUS_NAME: eventBus.eventBusName,
                FRONTEND_URL: frontendUrl
            }
        });
        const getReviewsLambda = new lambdaNodejs.NodejsFunction(this, "GetReviewsLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/review-service/src/handler.ts"),
            handler: "getReviewsByListing",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                REVIEWS_TABLE: reviewsTable.tableName,
                FRONTEND_URL: frontendUrl
            }
        });
        const notificationLambda = new lambdaNodejs.NodejsFunction(this, "NotificationLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/notification-service/src/handler.ts"),
            handler: "handleUserCreated",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                NOTIFICATIONS_TABLE: notificationsTable.tableName
            }
        });
        const mlPredictionLambda = new lambdaNodejs.NodejsFunction(this, "MlPredictionLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/ml-service/src/handler.ts"),
            handler: "predictSegment",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            timeout: cdk.Duration.seconds(30),
            environment: {
                FRONTEND_URL: frontendUrl,
                SAGEMAKER_ENDPOINT_NAME: sageMakerEndpoint.attrEndpointName
            }
        });
        mlPredictionLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ["sagemaker:InvokeEndpoint"],
            resources: [cdk.Stack.of(this).formatArn({
                    service: "sagemaker",
                    resource: "endpoint",
                    resourceName: sageMakerEndpoint.attrEndpointName
                })]
        }));
        notificationLambda.addEventSource(new lambdaEventSources.SqsEventSource(notificationQueue, {
            batchSize: 5,
            reportBatchItemFailures: true
        }));
        // Permisos
        usersTable.grantWriteData(userLambda);
        eventBus.grantPutEventsTo(userLambda);
        listingsTable.grantWriteData(listingLambda);
        eventBus.grantPutEventsTo(listingLambda);
        bookingsTable.grantWriteData(bookingLambda);
        bookingsTable.grantReadData(getBookingLambda);
        eventBus.grantPutEventsTo(bookingLambda);
        reviewsTable.grantWriteData(reviewLambda);
        reviewsTable.grantReadData(getReviewsLambda);
        eventBus.grantPutEventsTo(reviewLambda);
        notificationsTable.grantWriteData(notificationLambda);
        usersTable.grantWriteData(authConfirmLambda);
        usersTable.grantReadData(authLoginLambda);
        usersTable.grantReadData(authRefreshLambda);
        eventBus.grantPutEventsTo(authConfirmLambda);
        listingsTable.grantReadData(getListingsLambda);
        listingsTable.grantReadData(getAllListingsLambda);
        bookingsTable.grantReadData(getBookingsLambda);
        bookingsTable.grantReadData(getBookingsByListingLambda);
        authConfirmLambda.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: ["cognito-idp:AdminGetUser"],
            resources: [userPool.userPoolArn]
        }));
        // API Gateway
        const api = new apigateway.RestApi(this, "AirbnbApi", {
            restApiName: "Airbnb Service",
            defaultCorsPreflightOptions: {
                allowOrigins: [frontendUrl],
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: ["Content-Type", "X-Amz-Date", "Authorization", "X-Api-Key", "X-Amz-Security-Token"],
                allowCredentials: true,
            }
        });
        // Cognito Authorizer
        const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "Authorizer", {
            cognitoUserPools: [userPool]
        });
        const v1 = api.root.addResource("v1");
        const auth = v1.addResource("auth");
        auth.addResource("register").addMethod("POST", new apigateway.LambdaIntegration(authRegisterLambda));
        auth.addResource("confirm").addMethod("POST", new apigateway.LambdaIntegration(authConfirmLambda));
        auth.addResource("login").addMethod("POST", new apigateway.LambdaIntegration(authLoginLambda));
        auth.addResource("refresh").addMethod("POST", new apigateway.LambdaIntegration(authRefreshLambda));
        auth.addResource("logout").addMethod("POST", new apigateway.LambdaIntegration(authLogoutLambda));
        const users = v1.addResource("users");
        users.addMethod("POST", new apigateway.LambdaIntegration(userLambda), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        const listings = v1.addResource("listings");
        listings.addMethod("POST", new apigateway.LambdaIntegration(listingLambda), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        listings.addResource("my").addMethod("GET", new apigateway.LambdaIntegration(getListingsLambda), { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO });
        listings.addMethod("GET", new apigateway.LambdaIntegration(getAllListingsLambda)
        // Sin authorizer — endpoint público
        );
        const bookings = v1.addResource("bookings");
        bookings.addMethod("POST", new apigateway.LambdaIntegration(bookingLambda), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        const bookingById = bookings.addResource("{bookingId}");
        bookingById.addMethod("GET", new apigateway.LambdaIntegration(getBookingLambda), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        bookings.addResource("my").addMethod("GET", new apigateway.LambdaIntegration(getBookingsLambda), { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO });
        const listingBookings = listings.addResource("{listingId}").addResource("bookings");
        listingBookings.addMethod("GET", new apigateway.LambdaIntegration(getBookingsByListingLambda), { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO });
        const reviews = v1.addResource("reviews");
        reviews.addMethod("POST", new apigateway.LambdaIntegration(reviewLambda), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        const reviewsByListing = reviews.addResource("listing").addResource("{listingId}");
        reviewsByListing.addMethod("GET", new apigateway.LambdaIntegration(getReviewsLambda), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        const ml = v1.addResource("ml");
        ml.addResource("predict").addMethod("POST", new apigateway.LambdaIntegration(mlPredictionLambda), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        // S3 Bucket para hosting frontend
        const frontendDistPath = path.join(__dirname, "../../airbnb_group_front/dist");
        const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true
        });
        const spaRoutingFunction = new cloudfront.Function(this, "SpaRoutingFunction", {
            code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          var uri = request.uri;

          if (uri !== "/" && !uri.includes(".")) {
            request.uri = "/index.html";
          }

          return request;
        }
        `)
        });
        const distribution = new cloudfront.Distribution(this, "FrontendDistribution", {
            defaultBehavior: {
                origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                functionAssociations: [{
                        eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                        function: spaRoutingFunction
                    }]
            },
            defaultRootObject: "index.html"
        });
        distribution.addBehavior("/v1/*", new origins.RestApiOrigin(api), {
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        });
        new s3deploy.BucketDeployment(this, "DeployFrontend", {
            sources: [s3deploy.Source.asset(frontendDistPath)],
            destinationBucket: frontendBucket,
            distribution,
            distributionPaths: ["/*"]
        });
        // Outputs
        new cdk.CfnOutput(this, "UserPoolId", {
            value: userPool.userPoolId
        });
        new cdk.CfnOutput(this, "UserPoolClientId", {
            value: userPoolClient.userPoolClientId
        });
        new cdk.CfnOutput(this, "ApiUrl", {
            value: api.url
        });
        new cdk.CfnOutput(this, "EventBusName", {
            value: eventBus.eventBusName
        });
        new cdk.CfnOutput(this, "NotificationQueueUrl", {
            value: notificationQueue.queueUrl
        });
        new cdk.CfnOutput(this, "NotificationDLQUrl", {
            value: notificationDlq.queueUrl
        });
        new cdk.CfnOutput(this, "NotificationDLQName", {
            value: notificationDlq.queueName
        });
        new cdk.CfnOutput(this, "NotificationQueueName", {
            value: notificationQueue.queueName
        });
        new cdk.CfnOutput(this, "NotificationsTableName", {
            value: notificationsTable.tableName
        });
        new cdk.CfnOutput(this, "FrontendUrl", {
            value: `https://${distribution.distributionDomainName}`
        });
        new cdk.CfnOutput(this, "SageMakerEndpointName", {
            value: sageMakerEndpoint.attrEndpointName
        });
        cdk.RemovalPolicies.of(this).destroy();
    }
}
exports.CdkStack = CdkStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2RrLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY2RrLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZCQUE2QjtBQUM3QixtQ0FBbUM7QUFFbkMsbURBQW1EO0FBQ25ELHFEQUFxRDtBQUNyRCxpREFBaUQ7QUFDakQsaURBQWlEO0FBQ2pELDhEQUE4RDtBQUM5RCx5REFBeUQ7QUFDekQsMkNBQTJDO0FBQzNDLDBEQUEwRDtBQUMxRCwyRUFBMkU7QUFDM0UsMkNBQTJDO0FBQzNDLHNEQUFzRDtBQUN0RCx1REFBdUQ7QUFDdkQsNkRBQTZEO0FBQzdELHlDQUF5QztBQUN6Qyx5REFBeUQ7QUFDekQsOERBQThEO0FBQzlELDBEQUEwRDtBQUUxRCxNQUFhLFFBQVMsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNyQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sUUFBUSxHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztRQUU3RCw2RUFBNkU7UUFDN0UsTUFBTSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixJQUFJLElBQUksQ0FBQyxPQUFPLENBQ25FLFNBQVMsRUFDVCx1REFBdUQsQ0FDeEQsQ0FBQztRQUNGLE1BQU0sVUFBVSxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDOUQsSUFBSSxFQUFFLGdCQUFnQjtTQUN2QixDQUFDLENBQUM7UUFDSCxNQUFNLGFBQWEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLHdCQUF3QixFQUFFO1lBQ2pFLFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyx5QkFBeUIsQ0FBQztZQUM5RCxj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SSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxzQkFBc0IsRUFBRTtZQUM5QyxLQUFLLEVBQUUsaUJBQWlCLENBQUMsUUFBUTtTQUNsQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQzVDLEtBQUssRUFBRSxlQUFlLENBQUMsUUFBUTtTQUNoQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQzdDLEtBQUssRUFBRSxlQUFlLENBQUMsU0FBUztTQUNqQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHVCQUF1QixFQUFFO1lBQy9DLEtBQUssRUFBRSxpQkFBaUIsQ0FBQyxTQUFTO1NBQ25DLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLEVBQUU7WUFDaEQsS0FBSyxFQUFFLGtCQUFrQixDQUFDLFNBQVM7U0FDcEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDckMsS0FBSyxFQUFFLFdBQVcsWUFBWSxDQUFDLHNCQUFzQixFQUFFO1NBQ3hELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDL0MsS0FBSyxFQUFFLGlCQUFpQixDQUFDLGdCQUFnQjtTQUMxQyxDQUFDLENBQUM7UUFFSCxHQUFHLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUN6QyxDQUFDO0NBQ0Y7QUFsc0JELDRCQWtzQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBwYXRoIGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0ICogYXMgY29nbml0byBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNvZ25pdG9cIjtcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGJcIjtcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWV2ZW50c1wiO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhXCI7XG5pbXBvcnQgKiBhcyBsYW1iZGFOb2RlanMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzXCI7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheVwiO1xuaW1wb3J0ICogYXMgc3FzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgKiBhcyB0YXJnZXRzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHNcIjtcbmltcG9ydCAqIGFzIGxhbWJkYUV2ZW50U291cmNlcyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ldmVudC1zb3VyY2VzXCI7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCAqIGFzIHMzYXNzZXRzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtczMtYXNzZXRzXCI7XG5pbXBvcnQgKiBhcyBzYWdlbWFrZXIgZnJvbSBcImF3cy1jZGstbGliL2F3cy1zYWdlbWFrZXJcIjtcbi8vIGltcHBvcnRzIHBhcmEgZnJvbnRlbmQgeSBzMyBlc3RlIGNvZGlnbyBubyBlcyBhdXRvZ2VuZXJhZG9cbmltcG9ydCAqIGFzIHMzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtczNcIjtcbmltcG9ydCAqIGFzIGNsb3VkZnJvbnQgZnJvbSBcImF3cy1jZGstbGliL2F3cy1jbG91ZGZyb250XCI7XG5pbXBvcnQgKiBhcyBvcmlnaW5zIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udC1vcmlnaW5zXCI7XG5pbXBvcnQgKiBhcyBzM2RlcGxveSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnRcIjtcblxuZXhwb3J0IGNsYXNzIENka1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgZXZlbnRCdXMgPSBuZXcgZXZlbnRzLkV2ZW50QnVzKHRoaXMsIFwiQWlyYm5iRXZlbnRCdXNcIik7XG5cbiAgICAvLyBNb2RlbG8gYWNhZGVtaWNvIEstTWVhbnM6IENESyBwdWJsaWNhIG1vZGVsLnRhci5neiBlbiBzdSBidWNrZXQgZGUgYXNzZXRzLlxuICAgIGNvbnN0IG1vZGVsQXJjaGl2ZVBhdGggPSBwcm9jZXNzLmVudi5NTF9NT0RFTF9BUkNISVZFID8/IHBhdGgucmVzb2x2ZShcbiAgICAgIF9fZGlybmFtZSxcbiAgICAgIFwiLi4vLi4vLi4vTUxPcHMvcHJvdGVjdG9fbW9kdWxvXzE1L21vZGVscy9tb2RlbC50YXIuZ3pcIlxuICAgICk7XG4gICAgY29uc3QgbW9kZWxBc3NldCA9IG5ldyBzM2Fzc2V0cy5Bc3NldCh0aGlzLCBcIktNZWFuc01vZGVsQXNzZXRcIiwge1xuICAgICAgcGF0aDogbW9kZWxBcmNoaXZlUGF0aFxuICAgIH0pO1xuICAgIGNvbnN0IHNhZ2VNYWtlclJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgXCJTYWdlTWFrZXJFeGVjdXRpb25Sb2xlXCIsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKFwic2FnZW1ha2VyLmFtYXpvbmF3cy5jb21cIiksXG4gICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICBNb2RlbEFzc2V0UmVhZDogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgc3RhdGVtZW50czogW25ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgIGFjdGlvbnM6IFtcInMzOkdldE9iamVjdFwiLCBcInMzOkdldE9iamVjdFZlcnNpb25cIl0sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFtgJHttb2RlbEFzc2V0LmJ1Y2tldC5idWNrZXRBcm59LyR7bW9kZWxBc3NldC5zM09iamVjdEtleX1gXVxuICAgICAgICAgIH0pXVxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3Qgc2FnZU1ha2VyTW9kZWwgPSBuZXcgc2FnZW1ha2VyLkNmbk1vZGVsKHRoaXMsIFwiS01lYW5zU2FnZU1ha2VyTW9kZWxcIiwge1xuICAgICAgZXhlY3V0aW9uUm9sZUFybjogc2FnZU1ha2VyUm9sZS5yb2xlQXJuLFxuICAgICAgcHJpbWFyeUNvbnRhaW5lcjoge1xuICAgICAgICBpbWFnZTogY2RrLkZuLnN1YihcbiAgICAgICAgICBcIjI1Nzc1ODA0NDgxMS5ka3IuZWNyLiR7QVdTOjpSZWdpb259LiR7QVdTOjpVUkxTdWZmaXh9L3NhZ2VtYWtlci1zY2lraXQtbGVhcm46MS4yLTEtY3B1LXB5M1wiXG4gICAgICAgICksXG4gICAgICAgIG1vZGVsRGF0YVVybDogbW9kZWxBc3NldC5zM09iamVjdFVybCxcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBTQUdFTUFLRVJfUFJPR1JBTTogXCJpbmZlcmVuY2UucHlcIixcbiAgICAgICAgICBTQUdFTUFLRVJfU1VCTUlUX0RJUkVDVE9SWTogXCIvb3B0L21sL21vZGVsL2NvZGVcIlxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBzYWdlTWFrZXJFbmRwb2ludENvbmZpZyA9IG5ldyBzYWdlbWFrZXIuQ2ZuRW5kcG9pbnRDb25maWcodGhpcywgXCJLTWVhbnNFbmRwb2ludENvbmZpZ1wiLCB7XG4gICAgICBwcm9kdWN0aW9uVmFyaWFudHM6IFt7XG4gICAgICAgIG1vZGVsTmFtZTogc2FnZU1ha2VyTW9kZWwuYXR0ck1vZGVsTmFtZSxcbiAgICAgICAgdmFyaWFudE5hbWU6IFwiQWxsVHJhZmZpY1wiLFxuICAgICAgICBzZXJ2ZXJsZXNzQ29uZmlnOiB7XG4gICAgICAgICAgbWVtb3J5U2l6ZUluTWI6IDEwMjQsXG4gICAgICAgICAgbWF4Q29uY3VycmVuY3k6IDJcbiAgICAgICAgfVxuICAgICAgfV1cbiAgICB9KTtcblxuICAgIGNvbnN0IHNhZ2VNYWtlckVuZHBvaW50ID0gbmV3IHNhZ2VtYWtlci5DZm5FbmRwb2ludCh0aGlzLCBcIktNZWFuc0VuZHBvaW50XCIsIHtcbiAgICAgIGVuZHBvaW50Q29uZmlnTmFtZTogc2FnZU1ha2VyRW5kcG9pbnRDb25maWcuYXR0ckVuZHBvaW50Q29uZmlnTmFtZVxuICAgIH0pO1xuXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uRGxxID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCBcIk5vdGlmaWNhdGlvbkRMUVwiLCB7XG4gICAgICByZXRlbnRpb25QZXJpb2Q6IGNkay5EdXJhdGlvbi5kYXlzKDE0KSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1lcbiAgICB9KTtcblxuICAgIGNvbnN0IG5vdGlmaWNhdGlvblF1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCBcIk5vdGlmaWNhdGlvblF1ZXVlXCIsIHtcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICByZXRlbnRpb25QZXJpb2Q6IGNkay5EdXJhdGlvbi5kYXlzKDQpLFxuICAgICAgZGVhZExldHRlclF1ZXVlOiB7XG4gICAgICAgIHF1ZXVlOiBub3RpZmljYXRpb25EbHEsXG4gICAgICAgIG1heFJlY2VpdmVDb3VudDogM1xuICAgICAgfSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1lcbiAgICB9KTtcblxuICAgIG5ldyBldmVudHMuUnVsZSh0aGlzLCBcIk5vdGlmaWNhdGlvbkV2ZW50c1J1bGVcIiwge1xuICAgIGV2ZW50QnVzLFxuICAgIGV2ZW50UGF0dGVybjoge1xuICAgICAgc291cmNlOiBbXG4gICAgICAgIFwiYXV0aC5zZXJ2aWNlXCIsXG4gICAgICAgIFwidXNlci5zZXJ2aWNlXCIsXG4gICAgICAgIFwibGlzdGluZy5zZXJ2aWNlXCIsXG4gICAgICAgIFwiYm9va2luZy5zZXJ2aWNlXCIsXG4gICAgICAgIFwicmV2aWV3LnNlcnZpY2VcIlxuICAgICAgXSxcbiAgICAgIGRldGFpbFR5cGU6IFtcbiAgICAgICAgXCJ1c2VyLmNyZWF0ZWRcIixcbiAgICAgICAgXCJsaXN0aW5nLmNyZWF0ZWRcIixcbiAgICAgICAgXCJib29raW5nLmNyZWF0ZWRcIixcbiAgICAgICAgXCJyZXZpZXcuY3JlYXRlZFwiXG4gICAgICBdXG4gICAgfSxcbiAgICB0YXJnZXRzOiBbbmV3IHRhcmdldHMuU3FzUXVldWUobm90aWZpY2F0aW9uUXVldWUpXVxuICB9KTtcblxuICAgIC8vIENvZ25pdG8gVXNlciBQb29sXG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCBcIlVzZXJQb29sXCIsIHtcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogdHJ1ZSxcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHsgZW1haWw6IHRydWUgfSxcbiAgICAgIGF1dG9WZXJpZnk6IHsgZW1haWw6IHRydWUgfSxcbiAgICAgIHBhc3N3b3JkUG9saWN5OiB7XG4gICAgICAgIG1pbkxlbmd0aDogOCxcbiAgICAgICAgcmVxdWlyZUxvd2VyY2FzZTogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZVVwcGVyY2FzZTogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZURpZ2l0czogdHJ1ZVxuICAgICAgfSxcbiAgICAgIGN1c3RvbUF0dHJpYnV0ZXM6IHtcbiAgICAgICAgcm9sZTogbmV3IGNvZ25pdG8uU3RyaW5nQXR0cmlidXRlKHsgbXV0YWJsZTogdHJ1ZSB9KVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gQ29nbml0byBBcHAgQ2xpZW50XG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCBcIlVzZXJQb29sQ2xpZW50XCIsIHtcbiAgICAgIHVzZXJQb29sLFxuICAgICAgYXV0aEZsb3dzOiB7XG4gICAgICAgIHVzZXJQYXNzd29yZDogdHJ1ZSxcbiAgICAgICAgdXNlclNycDogdHJ1ZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gRHluYW1vREIgVGFibGVcbiAgICBjb25zdCB1c2Vyc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsIFwiVXNlcnNUYWJsZVwiLCB7XG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJlbWFpbFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1lcbiAgICB9KTtcblxuICAgIGNvbnN0IGxpc3RpbmdzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgXCJMaXN0aW5nc1RhYmxlXCIsIHtcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcImxpc3RpbmdJZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1lcbiAgICB9KTtcblxuICAgIGxpc3RpbmdzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiBcIm93bmVySWQtaW5kZXhcIixcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcIm93bmVySWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgYm9va2luZ3NUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCBcIkJvb2tpbmdzVGFibGVcIiwge1xuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwiYm9va2luZ0lkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgIH0pO1xuXG4gICAgYm9va2luZ3NUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6IFwiZ3Vlc3RJZC1pbmRleFwiLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwiZ3Vlc3RJZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9XG4gICAgfSk7XG5cbiAgICBib29raW5nc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogXCJsaXN0aW5nSWQtaW5kZXhcIixcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcImxpc3RpbmdJZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9XG4gICAgfSk7XG5cbiAgICBjb25zdCByZXZpZXdzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgXCJSZXZpZXdzVGFibGVcIiwge1xuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwicmV2aWV3SWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgfSk7XG5cbiAgICBjb25zdCBub3RpZmljYXRpb25zVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgXCJOb3RpZmljYXRpb25zVGFibGVcIiwge1xuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwibm90aWZpY2F0aW9uSWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgfSk7XG5cbiAgICByZXZpZXdzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiBcImxpc3RpbmdJZC1pbmRleFwiLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwibGlzdGluZ0lkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH1cbiAgICB9KTtcblxuICAgIC8vIExhbWJkYVxuICAgIGNvbnN0IHNlcnZpY2VzUm9vdCA9IHBhdGguam9pbihfX2Rpcm5hbWUsIFwiLi4vLi4vYWlyYm5iX2dyb3VwX3NlcnZpY2VzXCIpO1xuICAgIGNvbnN0IGZyb250ZW5kVXJsID0gcHJvY2Vzcy5lbnYuRlJPTlRFTkRfVVJMITtcblxuICAgIGNvbnN0IGF1dGhSZWdpc3RlckxhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJBdXRoUmVnaXN0ZXJMYW1iZGFcIiwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKFxuICAgICAgICBzZXJ2aWNlc1Jvb3QsXG4gICAgICAgIFwic2VydmljZXMvYXV0aC1zZXJ2aWNlL3NyYy9oYW5kbGVyLnRzXCJcbiAgICAgICksXG4gICAgICBoYW5kbGVyOiBcInJlZ2lzdGVyXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFVTRVJfUE9PTF9DTElFTlRfSUQ6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICAgIEZST05URU5EX1VSTDogZnJvbnRlbmRVcmxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IGF1dGhDb25maXJtTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBcIkF1dGhDb25maXJtTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL2F1dGgtc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJjb25maXJtXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFVTRVJfUE9PTF9DTElFTlRfSUQ6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICAgIFVTRVJfUE9PTF9JRDogdXNlclBvb2wudXNlclBvb2xJZCxcbiAgICAgICAgVVNFUlNfVEFCTEU6IHVzZXJzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBFVkVOVF9CVVNfTkFNRTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxuICAgICAgICBGUk9OVEVORF9VUkw6IGZyb250ZW5kVXJsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBhdXRoTG9naW5MYW1iZGEgPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsIFwiQXV0aExvZ2luTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL2F1dGgtc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJsb2dpblwiLFxuICAgICAgcHJvamVjdFJvb3Q6IHNlcnZpY2VzUm9vdCxcbiAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwicGFja2FnZS1sb2NrLmpzb25cIiksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBVU0VSX1BPT0xfQ0xJRU5UX0lEOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICBVU0VSX1BPT0xfSUQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICAgIFVTRVJTX1RBQkxFOiB1c2Vyc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRlJPTlRFTkRfVVJMOiBmcm9udGVuZFVybFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgYXV0aFJlZnJlc2hMYW1iZGEgPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsIFwiQXV0aFJlZnJlc2hMYW1iZGFcIiwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKFxuICAgICAgICBzZXJ2aWNlc1Jvb3QsXG4gICAgICAgIFwic2VydmljZXMvYXV0aC1zZXJ2aWNlL3NyYy9oYW5kbGVyLnRzXCJcbiAgICAgICksXG4gICAgICBoYW5kbGVyOiBcInJlZnJlc2hcIixcbiAgICAgIHByb2plY3RSb290OiBzZXJ2aWNlc1Jvb3QsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInBhY2thZ2UtbG9jay5qc29uXCIpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgVVNFUl9QT09MX0NMSUVOVF9JRDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgICAgVVNFUlNfVEFCTEU6IHVzZXJzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBGUk9OVEVORF9VUkw6IGZyb250ZW5kVXJsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBhdXRoTG9nb3V0TGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBcIkF1dGhMb2dvdXRMYW1iZGFcIiwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKFxuICAgICAgICBzZXJ2aWNlc1Jvb3QsXG4gICAgICAgIFwic2VydmljZXMvYXV0aC1zZXJ2aWNlL3NyYy9oYW5kbGVyLnRzXCJcbiAgICAgICksXG4gICAgICBoYW5kbGVyOiBcImxvZ291dFwiLFxuICAgICAgcHJvamVjdFJvb3Q6IHNlcnZpY2VzUm9vdCxcbiAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwicGFja2FnZS1sb2NrLmpzb25cIiksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBGUk9OVEVORF9VUkw6IGZyb250ZW5kVXJsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCB1c2VyTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBcIlVzZXJMYW1iZGFcIiwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKFxuICAgICAgICBzZXJ2aWNlc1Jvb3QsXG4gICAgICAgIFwic2VydmljZXMvdXNlci1zZXJ2aWNlL3NyYy9oYW5kbGVyLnRzXCJcbiAgICAgICksXG4gICAgICBoYW5kbGVyOiBcImNyZWF0ZVVzZXJcIixcbiAgICAgIHByb2plY3RSb290OiBzZXJ2aWNlc1Jvb3QsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInBhY2thZ2UtbG9jay5qc29uXCIpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgVVNFUlNfVEFCTEU6IHVzZXJzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBFVkVOVF9CVVNfTkFNRTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxuICAgICAgICBGUk9OVEVORF9VUkw6IGZyb250ZW5kVXJsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBsaXN0aW5nTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBcIkxpc3RpbmdMYW1iZGFcIiwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKFxuICAgICAgICBzZXJ2aWNlc1Jvb3QsXG4gICAgICAgIFwic2VydmljZXMvbGlzdGluZy1zZXJ2aWNlL3NyYy9oYW5kbGVyLnRzXCJcbiAgICAgICksXG4gICAgICBoYW5kbGVyOiBcImNyZWF0ZUxpc3RpbmdcIixcbiAgICAgIHByb2plY3RSb290OiBzZXJ2aWNlc1Jvb3QsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInBhY2thZ2UtbG9jay5qc29uXCIpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgTElTVElOR1NfVEFCTEU6IGxpc3RpbmdzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBFVkVOVF9CVVNfTkFNRTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxuICAgICAgICBGUk9OVEVORF9VUkw6IGZyb250ZW5kVXJsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBnZXRMaXN0aW5nc0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJHZXRMaXN0aW5nc0xhbWJkYVwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInNlcnZpY2VzL2xpc3Rpbmctc2VydmljZS9zcmMvaGFuZGxlci50c1wiKSxcbiAgICAgIGhhbmRsZXI6IFwiZ2V0TGlzdGluZ3NCeU93bmVyXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7IFxuICAgICAgICBMSVNUSU5HU19UQUJMRTogbGlzdGluZ3NUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIEZST05URU5EX1VSTDogZnJvbnRlbmRVcmxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IGdldEFsbExpc3RpbmdzTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBcIkdldEFsbExpc3RpbmdzTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwic2VydmljZXMvbGlzdGluZy1zZXJ2aWNlL3NyYy9oYW5kbGVyLnRzXCIpLFxuICAgICAgaGFuZGxlcjogXCJnZXRBbGxMaXN0aW5nc1wiLFxuICAgICAgcHJvamVjdFJvb3Q6IHNlcnZpY2VzUm9vdCxcbiAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwicGFja2FnZS1sb2NrLmpzb25cIiksXG4gICAgICBlbnZpcm9ubWVudDogeyBcbiAgICAgICAgTElTVElOR1NfVEFCTEU6IGxpc3RpbmdzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBGUk9OVEVORF9VUkw6IGZyb250ZW5kVXJsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBib29raW5nTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBcIkJvb2tpbmdMYW1iZGFcIiwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKFxuICAgICAgICBzZXJ2aWNlc1Jvb3QsXG4gICAgICAgIFwic2VydmljZXMvYm9va2luZy1zZXJ2aWNlL3NyYy9oYW5kbGVyLnRzXCJcbiAgICAgICksXG4gICAgICBoYW5kbGVyOiBcImNyZWF0ZUJvb2tpbmdcIixcbiAgICAgIHByb2plY3RSb290OiBzZXJ2aWNlc1Jvb3QsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInBhY2thZ2UtbG9jay5qc29uXCIpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgQk9PS0lOR1NfVEFCTEU6IGJvb2tpbmdzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBFVkVOVF9CVVNfTkFNRTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxuICAgICAgICBGUk9OVEVORF9VUkw6IGZyb250ZW5kVXJsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBnZXRCb29raW5nc0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJHZXRCb29raW5nc0xhbWJkYVwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInNlcnZpY2VzL2Jvb2tpbmctc2VydmljZS9zcmMvaGFuZGxlci50c1wiKSxcbiAgICAgIGhhbmRsZXI6IFwiZ2V0Qm9va2luZ3NCeUd1ZXN0XCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7IFxuICAgICAgICBCT09LSU5HU19UQUJMRTogYm9va2luZ3NUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIEZST05URU5EX1VSTDogZnJvbnRlbmRVcmxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IGdldEJvb2tpbmdzQnlMaXN0aW5nTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBcIkdldEJvb2tpbmdzQnlMaXN0aW5nTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwic2VydmljZXMvYm9va2luZy1zZXJ2aWNlL3NyYy9oYW5kbGVyLnRzXCIpLFxuICAgICAgaGFuZGxlcjogXCJnZXRCb29raW5nc0J5TGlzdGluZ1wiLFxuICAgICAgcHJvamVjdFJvb3Q6IHNlcnZpY2VzUm9vdCxcbiAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwicGFja2FnZS1sb2NrLmpzb25cIiksXG4gICAgICBlbnZpcm9ubWVudDogeyBcbiAgICAgICAgQk9PS0lOR1NfVEFCTEU6IGJvb2tpbmdzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBGUk9OVEVORF9VUkw6IGZyb250ZW5kVXJsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBnZXRCb29raW5nTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBcIkdldEJvb2tpbmdMYW1iZGFcIiwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKFxuICAgICAgICBzZXJ2aWNlc1Jvb3QsXG4gICAgICAgIFwic2VydmljZXMvYm9va2luZy1zZXJ2aWNlL3NyYy9oYW5kbGVyLnRzXCJcbiAgICAgICksXG4gICAgICBoYW5kbGVyOiBcImdldEJvb2tpbmdCeUlkXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIEJPT0tJTkdTX1RBQkxFOiBib29raW5nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRlJPTlRFTkRfVVJMOiBmcm9udGVuZFVybFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgcmV2aWV3TGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBcIlJldmlld0xhbWJkYVwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oXG4gICAgICAgIHNlcnZpY2VzUm9vdCxcbiAgICAgICAgXCJzZXJ2aWNlcy9yZXZpZXctc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJjcmVhdGVSZXZpZXdcIixcbiAgICAgIHByb2plY3RSb290OiBzZXJ2aWNlc1Jvb3QsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInBhY2thZ2UtbG9jay5qc29uXCIpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgUkVWSUVXU19UQUJMRTogcmV2aWV3c1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcbiAgICAgICAgRlJPTlRFTkRfVVJMOiBmcm9udGVuZFVybFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgZ2V0UmV2aWV3c0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJHZXRSZXZpZXdzTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL3Jldmlldy1zZXJ2aWNlL3NyYy9oYW5kbGVyLnRzXCJcbiAgICAgICksXG4gICAgICBoYW5kbGVyOiBcImdldFJldmlld3NCeUxpc3RpbmdcIixcbiAgICAgIHByb2plY3RSb290OiBzZXJ2aWNlc1Jvb3QsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInBhY2thZ2UtbG9jay5qc29uXCIpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgUkVWSUVXU19UQUJMRTogcmV2aWV3c1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRlJPTlRFTkRfVVJMOiBmcm9udGVuZFVybFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBcIk5vdGlmaWNhdGlvbkxhbWJkYVwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oXG4gICAgICAgIHNlcnZpY2VzUm9vdCxcbiAgICAgICAgXCJzZXJ2aWNlcy9ub3RpZmljYXRpb24tc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJoYW5kbGVVc2VyQ3JlYXRlZFwiLFxuICAgICAgcHJvamVjdFJvb3Q6IHNlcnZpY2VzUm9vdCxcbiAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwicGFja2FnZS1sb2NrLmpzb25cIiksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBOT1RJRklDQVRJT05TX1RBQkxFOiBub3RpZmljYXRpb25zVGFibGUudGFibGVOYW1lXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBtbFByZWRpY3Rpb25MYW1iZGEgPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsIFwiTWxQcmVkaWN0aW9uTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwic2VydmljZXMvbWwtc2VydmljZS9zcmMvaGFuZGxlci50c1wiKSxcbiAgICAgIGhhbmRsZXI6IFwicHJlZGljdFNlZ21lbnRcIixcbiAgICAgIHByb2plY3RSb290OiBzZXJ2aWNlc1Jvb3QsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInBhY2thZ2UtbG9jay5qc29uXCIpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgRlJPTlRFTkRfVVJMOiBmcm9udGVuZFVybCxcbiAgICAgICAgU0FHRU1BS0VSX0VORFBPSU5UX05BTUU6IHNhZ2VNYWtlckVuZHBvaW50LmF0dHJFbmRwb2ludE5hbWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIG1sUHJlZGljdGlvbkxhbWJkYS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogW1wic2FnZW1ha2VyOkludm9rZUVuZHBvaW50XCJdLFxuICAgICAgcmVzb3VyY2VzOiBbY2RrLlN0YWNrLm9mKHRoaXMpLmZvcm1hdEFybih7XG4gICAgICAgIHNlcnZpY2U6IFwic2FnZW1ha2VyXCIsXG4gICAgICAgIHJlc291cmNlOiBcImVuZHBvaW50XCIsXG4gICAgICAgIHJlc291cmNlTmFtZTogc2FnZU1ha2VyRW5kcG9pbnQuYXR0ckVuZHBvaW50TmFtZVxuICAgICAgfSldXG4gICAgfSkpO1xuXG4gICAgbm90aWZpY2F0aW9uTGFtYmRhLmFkZEV2ZW50U291cmNlKFxuICAgICAgbmV3IGxhbWJkYUV2ZW50U291cmNlcy5TcXNFdmVudFNvdXJjZShub3RpZmljYXRpb25RdWV1ZSwge1xuICAgICAgICBiYXRjaFNpemU6IDUsXG4gICAgICAgIHJlcG9ydEJhdGNoSXRlbUZhaWx1cmVzOiB0cnVlXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBQZXJtaXNvc1xuICAgIHVzZXJzVGFibGUuZ3JhbnRXcml0ZURhdGEodXNlckxhbWJkYSk7XG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyh1c2VyTGFtYmRhKTtcbiAgICBsaXN0aW5nc1RhYmxlLmdyYW50V3JpdGVEYXRhKGxpc3RpbmdMYW1iZGEpO1xuICAgIGV2ZW50QnVzLmdyYW50UHV0RXZlbnRzVG8obGlzdGluZ0xhbWJkYSk7XG4gICAgYm9va2luZ3NUYWJsZS5ncmFudFdyaXRlRGF0YShib29raW5nTGFtYmRhKTtcbiAgICBib29raW5nc1RhYmxlLmdyYW50UmVhZERhdGEoZ2V0Qm9va2luZ0xhbWJkYSk7XG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyhib29raW5nTGFtYmRhKTtcbiAgICByZXZpZXdzVGFibGUuZ3JhbnRXcml0ZURhdGEocmV2aWV3TGFtYmRhKTtcbiAgICByZXZpZXdzVGFibGUuZ3JhbnRSZWFkRGF0YShnZXRSZXZpZXdzTGFtYmRhKTtcbiAgICBldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKHJldmlld0xhbWJkYSk7XG4gICAgbm90aWZpY2F0aW9uc1RhYmxlLmdyYW50V3JpdGVEYXRhKG5vdGlmaWNhdGlvbkxhbWJkYSk7XG4gICAgdXNlcnNUYWJsZS5ncmFudFdyaXRlRGF0YShhdXRoQ29uZmlybUxhbWJkYSk7XG4gICAgdXNlcnNUYWJsZS5ncmFudFJlYWREYXRhKGF1dGhMb2dpbkxhbWJkYSk7XG4gICAgdXNlcnNUYWJsZS5ncmFudFJlYWREYXRhKGF1dGhSZWZyZXNoTGFtYmRhKTtcbiAgICBldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKGF1dGhDb25maXJtTGFtYmRhKTtcbiAgICBsaXN0aW5nc1RhYmxlLmdyYW50UmVhZERhdGEoZ2V0TGlzdGluZ3NMYW1iZGEpO1xuICAgIGxpc3RpbmdzVGFibGUuZ3JhbnRSZWFkRGF0YShnZXRBbGxMaXN0aW5nc0xhbWJkYSk7XG4gICAgYm9va2luZ3NUYWJsZS5ncmFudFJlYWREYXRhKGdldEJvb2tpbmdzTGFtYmRhKTtcbiAgICBib29raW5nc1RhYmxlLmdyYW50UmVhZERhdGEoZ2V0Qm9va2luZ3NCeUxpc3RpbmdMYW1iZGEpO1xuXG5cbiAgICBhdXRoQ29uZmlybUxhbWJkYS5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgY2RrLmF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1wiY29nbml0by1pZHA6QWRtaW5HZXRVc2VyXCJdLFxuICAgICAgICByZXNvdXJjZXM6IFt1c2VyUG9vbC51c2VyUG9vbEFybl1cbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIEFQSSBHYXRld2F5XG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCBcIkFpcmJuYkFwaVwiLCB7XG4gICAgICByZXN0QXBpTmFtZTogXCJBaXJibmIgU2VydmljZVwiLFxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XG4gICAgICAgIGFsbG93T3JpZ2luczogW2Zyb250ZW5kVXJsXSxcbiAgICAgICAgYWxsb3dNZXRob2RzOiBhcGlnYXRld2F5LkNvcnMuQUxMX01FVEhPRFMsXG4gICAgICAgIGFsbG93SGVhZGVyczogW1wiQ29udGVudC1UeXBlXCIsIFwiWC1BbXotRGF0ZVwiLCBcIkF1dGhvcml6YXRpb25cIiwgXCJYLUFwaS1LZXlcIiwgXCJYLUFtei1TZWN1cml0eS1Ub2tlblwiXSxcbiAgICAgICAgYWxsb3dDcmVkZW50aWFsczogdHJ1ZSxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIENvZ25pdG8gQXV0aG9yaXplclxuICAgIGNvbnN0IGF1dGhvcml6ZXIgPSBuZXcgYXBpZ2F0ZXdheS5Db2duaXRvVXNlclBvb2xzQXV0aG9yaXplcih0aGlzLCBcIkF1dGhvcml6ZXJcIiwge1xuICAgICAgY29nbml0b1VzZXJQb29sczogW3VzZXJQb29sXVxuICAgIH0pO1xuXG4gICAgY29uc3QgdjEgPSBhcGkucm9vdC5hZGRSZXNvdXJjZShcInYxXCIpO1xuXG4gICAgY29uc3QgYXV0aCA9IHYxLmFkZFJlc291cmNlKFwiYXV0aFwiKTtcblxuICAgIGF1dGguYWRkUmVzb3VyY2UoXCJyZWdpc3RlclwiKS5hZGRNZXRob2QoXG4gICAgICBcIlBPU1RcIixcbiAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGF1dGhSZWdpc3RlckxhbWJkYSlcbiAgICApO1xuXG4gICAgYXV0aC5hZGRSZXNvdXJjZShcImNvbmZpcm1cIikuYWRkTWV0aG9kKFxuICAgICAgXCJQT1NUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihhdXRoQ29uZmlybUxhbWJkYSlcbiAgICApO1xuXG4gICAgYXV0aC5hZGRSZXNvdXJjZShcImxvZ2luXCIpLmFkZE1ldGhvZChcbiAgICAgIFwiUE9TVFwiLFxuICAgICAgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oYXV0aExvZ2luTGFtYmRhKVxuICAgICk7XG5cbiAgICBhdXRoLmFkZFJlc291cmNlKFwicmVmcmVzaFwiKS5hZGRNZXRob2QoXG4gICAgICBcIlBPU1RcIixcbiAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGF1dGhSZWZyZXNoTGFtYmRhKVxuICAgICk7XG5cbiAgICBhdXRoLmFkZFJlc291cmNlKFwibG9nb3V0XCIpLmFkZE1ldGhvZChcbiAgICAgIFwiUE9TVFwiLFxuICAgICAgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oYXV0aExvZ291dExhbWJkYSlcbiAgICApO1xuXG4gICAgY29uc3QgdXNlcnMgPSB2MS5hZGRSZXNvdXJjZShcInVzZXJzXCIpO1xuXG4gICAgdXNlcnMuYWRkTWV0aG9kKFxuICAgICAgXCJQT1NUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbih1c2VyTGFtYmRhKSxcbiAgICAgIHtcbiAgICAgICAgYXV0aG9yaXplcixcbiAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgICAgfVxuICAgICk7XG5cbiAgICBjb25zdCBsaXN0aW5ncyA9IHYxLmFkZFJlc291cmNlKFwibGlzdGluZ3NcIik7XG5cbiAgICBsaXN0aW5ncy5hZGRNZXRob2QoXG4gICAgICBcIlBPU1RcIixcbiAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGxpc3RpbmdMYW1iZGEpLFxuICAgICAge1xuICAgICAgICBhdXRob3JpemVyLFxuICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPXG4gICAgICB9XG4gICAgKTtcblxuICAgIGxpc3RpbmdzLmFkZFJlc291cmNlKFwibXlcIikuYWRkTWV0aG9kKFxuICAgICAgXCJHRVRcIixcbiAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGdldExpc3RpbmdzTGFtYmRhKSxcbiAgICAgIHsgYXV0aG9yaXplciwgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUTyB9XG4gICAgKTtcblxuICAgIGxpc3RpbmdzLmFkZE1ldGhvZChcbiAgICAgIFwiR0VUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihnZXRBbGxMaXN0aW5nc0xhbWJkYSlcbiAgICAgIC8vIFNpbiBhdXRob3JpemVyIOKAlCBlbmRwb2ludCBww7pibGljb1xuICAgICk7XG5cbiAgICBjb25zdCBib29raW5ncyA9IHYxLmFkZFJlc291cmNlKFwiYm9va2luZ3NcIik7XG5cbiAgICBib29raW5ncy5hZGRNZXRob2QoXG4gICAgICBcIlBPU1RcIixcbiAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGJvb2tpbmdMYW1iZGEpLFxuICAgICAge1xuICAgICAgICBhdXRob3JpemVyLFxuICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPXG4gICAgICB9XG4gICAgKTtcblxuICAgIGNvbnN0IGJvb2tpbmdCeUlkID0gYm9va2luZ3MuYWRkUmVzb3VyY2UoXCJ7Ym9va2luZ0lkfVwiKTtcblxuICAgIGJvb2tpbmdCeUlkLmFkZE1ldGhvZChcbiAgICAgIFwiR0VUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihnZXRCb29raW5nTGFtYmRhKSxcbiAgICAgIHtcbiAgICAgICAgYXV0aG9yaXplcixcbiAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgICAgfVxuICAgICk7XG5cbiAgICBib29raW5ncy5hZGRSZXNvdXJjZShcIm15XCIpLmFkZE1ldGhvZChcbiAgICAgIFwiR0VUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihnZXRCb29raW5nc0xhbWJkYSksXG4gICAgICB7IGF1dGhvcml6ZXIsIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8gfVxuICAgICk7XG5cbiAgICBjb25zdCBsaXN0aW5nQm9va2luZ3MgPSBsaXN0aW5ncy5hZGRSZXNvdXJjZShcIntsaXN0aW5nSWR9XCIpLmFkZFJlc291cmNlKFwiYm9va2luZ3NcIik7XG4gICAgbGlzdGluZ0Jvb2tpbmdzLmFkZE1ldGhvZChcbiAgICAgIFwiR0VUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihnZXRCb29raW5nc0J5TGlzdGluZ0xhbWJkYSksXG4gICAgICB7IGF1dGhvcml6ZXIsIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8gfVxuICAgICk7XG4gICAgY29uc3QgcmV2aWV3cyA9IHYxLmFkZFJlc291cmNlKFwicmV2aWV3c1wiKTtcblxuICAgIHJldmlld3MuYWRkTWV0aG9kKFwiUE9TVFwiLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihyZXZpZXdMYW1iZGEpLCB7XG4gICAgICBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuXG4gICAgY29uc3QgcmV2aWV3c0J5TGlzdGluZyA9IHJldmlld3MuYWRkUmVzb3VyY2UoXCJsaXN0aW5nXCIpLmFkZFJlc291cmNlKFwie2xpc3RpbmdJZH1cIik7XG5cbiAgICByZXZpZXdzQnlMaXN0aW5nLmFkZE1ldGhvZChcbiAgICAgIFwiR0VUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihnZXRSZXZpZXdzTGFtYmRhKSxcbiAgICAgIHtcbiAgICAgICAgYXV0aG9yaXplcixcbiAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgICAgfVxuICAgICk7XG5cbiAgICBjb25zdCBtbCA9IHYxLmFkZFJlc291cmNlKFwibWxcIik7XG4gICAgbWwuYWRkUmVzb3VyY2UoXCJwcmVkaWN0XCIpLmFkZE1ldGhvZChcbiAgICAgIFwiUE9TVFwiLFxuICAgICAgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24obWxQcmVkaWN0aW9uTGFtYmRhKSxcbiAgICAgIHtcbiAgICAgICAgYXV0aG9yaXplcixcbiAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBTMyBCdWNrZXQgcGFyYSBob3N0aW5nIGZyb250ZW5kXG4gICAgY29uc3QgZnJvbnRlbmREaXN0UGF0aCA9IHBhdGguam9pbihcbiAgICAgIF9fZGlybmFtZSxcbiAgICAgIFwiLi4vLi4vYWlyYm5iX2dyb3VwX2Zyb250L2Rpc3RcIlxuICAgICk7XG5cbiAgICBjb25zdCBmcm9udGVuZEJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgXCJGcm9udGVuZEJ1Y2tldFwiLCB7XG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlXG4gICAgfSk7XG5cbiAgICBjb25zdCBzcGFSb3V0aW5nRnVuY3Rpb24gPSBuZXcgY2xvdWRmcm9udC5GdW5jdGlvbih0aGlzLCBcIlNwYVJvdXRpbmdGdW5jdGlvblwiLCB7XG4gICAgICBjb2RlOiBjbG91ZGZyb250LkZ1bmN0aW9uQ29kZS5mcm9tSW5saW5lKGBcbiAgICAgICAgZnVuY3Rpb24gaGFuZGxlcihldmVudCkge1xuICAgICAgICAgIHZhciByZXF1ZXN0ID0gZXZlbnQucmVxdWVzdDtcbiAgICAgICAgICB2YXIgdXJpID0gcmVxdWVzdC51cmk7XG5cbiAgICAgICAgICBpZiAodXJpICE9PSBcIi9cIiAmJiAhdXJpLmluY2x1ZGVzKFwiLlwiKSkge1xuICAgICAgICAgICAgcmVxdWVzdC51cmkgPSBcIi9pbmRleC5odG1sXCI7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIHJlcXVlc3Q7XG4gICAgICAgIH1cbiAgICAgICAgYClcbiAgICB9KTtcblxuICAgIGNvbnN0IGRpc3RyaWJ1dGlvbiA9IG5ldyBjbG91ZGZyb250LkRpc3RyaWJ1dGlvbih0aGlzLCBcIkZyb250ZW5kRGlzdHJpYnV0aW9uXCIsIHtcbiAgICAgIGRlZmF1bHRCZWhhdmlvcjoge1xuICAgICAgICBvcmlnaW46IG9yaWdpbnMuUzNCdWNrZXRPcmlnaW4ud2l0aE9yaWdpbkFjY2Vzc0NvbnRyb2woZnJvbnRlbmRCdWNrZXQpLFxuICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgZnVuY3Rpb25Bc3NvY2lhdGlvbnM6IFt7XG4gICAgICAgICAgZXZlbnRUeXBlOiBjbG91ZGZyb250LkZ1bmN0aW9uRXZlbnRUeXBlLlZJRVdFUl9SRVFVRVNULFxuICAgICAgICAgIGZ1bmN0aW9uOiBzcGFSb3V0aW5nRnVuY3Rpb25cbiAgICAgICAgfV1cbiAgICAgIH0sXG4gICAgICBkZWZhdWx0Um9vdE9iamVjdDogXCJpbmRleC5odG1sXCJcbiAgICB9KTtcblxuICAgIGRpc3RyaWJ1dGlvbi5hZGRCZWhhdmlvcihcIi92MS8qXCIsIG5ldyBvcmlnaW5zLlJlc3RBcGlPcmlnaW4oYXBpKSwge1xuICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19BTEwsXG4gICAgICBjYWNoZVBvbGljeTogY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX0RJU0FCTEVELFxuICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTogY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5LkFMTF9WSUVXRVJfRVhDRVBUX0hPU1RfSEVBREVSLFxuICAgIH0pO1xuXG4gICAgbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgXCJEZXBsb3lGcm9udGVuZFwiLCB7XG4gICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmFzc2V0KGZyb250ZW5kRGlzdFBhdGgpXSxcbiAgICAgIGRlc3RpbmF0aW9uQnVja2V0OiBmcm9udGVuZEJ1Y2tldCxcbiAgICAgIGRpc3RyaWJ1dGlvbixcbiAgICAgIGRpc3RyaWJ1dGlvblBhdGhzOiBbXCIvKlwiXVxuICAgIH0pO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiVXNlclBvb2xJZFwiLCB7XG4gICAgICB2YWx1ZTogdXNlclBvb2wudXNlclBvb2xJZFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJVc2VyUG9vbENsaWVudElkXCIsIHtcbiAgICAgIHZhbHVlOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFwaVVybFwiLCB7XG4gICAgICB2YWx1ZTogYXBpLnVybFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJFdmVudEJ1c05hbWVcIiwge1xuICAgICAgdmFsdWU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZVxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJOb3RpZmljYXRpb25RdWV1ZVVybFwiLCB7XG4gICAgICB2YWx1ZTogbm90aWZpY2F0aW9uUXVldWUucXVldWVVcmxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTm90aWZpY2F0aW9uRExRVXJsXCIsIHtcbiAgICAgIHZhbHVlOiBub3RpZmljYXRpb25EbHEucXVldWVVcmxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTm90aWZpY2F0aW9uRExRTmFtZVwiLCB7XG4gICAgICB2YWx1ZTogbm90aWZpY2F0aW9uRGxxLnF1ZXVlTmFtZVxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJOb3RpZmljYXRpb25RdWV1ZU5hbWVcIiwge1xuICAgICAgdmFsdWU6IG5vdGlmaWNhdGlvblF1ZXVlLnF1ZXVlTmFtZVxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJOb3RpZmljYXRpb25zVGFibGVOYW1lXCIsIHtcbiAgICAgIHZhbHVlOiBub3RpZmljYXRpb25zVGFibGUudGFibGVOYW1lXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkZyb250ZW5kVXJsXCIsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke2Rpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lfWBcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiU2FnZU1ha2VyRW5kcG9pbnROYW1lXCIsIHtcbiAgICAgIHZhbHVlOiBzYWdlTWFrZXJFbmRwb2ludC5hdHRyRW5kcG9pbnROYW1lXG4gICAgfSk7XG5cbiAgICBjZGsuUmVtb3ZhbFBvbGljaWVzLm9mKHRoaXMpLmRlc3Ryb3koKTtcbiAgfVxufVxuIl19
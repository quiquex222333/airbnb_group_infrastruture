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
// impports para frontend y s3 este codigo no es autogenerado
const s3 = require("aws-cdk-lib/aws-s3");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const origins = require("aws-cdk-lib/aws-cloudfront-origins");
const s3deploy = require("aws-cdk-lib/aws-s3-deployment");
class CdkStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const eventBus = new events.EventBus(this, "AirbnbEventBus");
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
            removalPolicy: cdk.RemovalPolicy.DESTROY // solo para demo
        });
        const listingsTable = new dynamodb.Table(this, "ListingsTable", {
            partitionKey: { name: "listingId", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
        });
        listingsTable.addGlobalSecondaryIndex({
            indexName: "ownerId-index",
            partitionKey: { name: "ownerId", type: dynamodb.AttributeType.STRING }
        });
        const bookingsTable = new dynamodb.Table(this, "BookingsTable", {
            partitionKey: { name: "bookingId", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
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
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
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
    }
}
exports.CdkStack = CdkStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2RrLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY2RrLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZCQUE2QjtBQUM3QixtQ0FBbUM7QUFFbkMsbURBQW1EO0FBQ25ELHFEQUFxRDtBQUNyRCxpREFBaUQ7QUFDakQsaURBQWlEO0FBQ2pELDhEQUE4RDtBQUM5RCx5REFBeUQ7QUFDekQsMkNBQTJDO0FBQzNDLDBEQUEwRDtBQUMxRCwyRUFBMkU7QUFDM0UsNkRBQTZEO0FBQzdELHlDQUF5QztBQUN6Qyx5REFBeUQ7QUFDekQsOERBQThEO0FBQzlELDBEQUEwRDtBQUUxRCxNQUFhLFFBQVMsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNyQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sUUFBUSxHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztRQUU3RCxNQUFNLGVBQWUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQzdELGVBQWUsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDdEMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztTQUN6QyxDQUFDLENBQUM7UUFFSCxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDakUsaUJBQWlCLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQzNDLGVBQWUsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7WUFDckMsZUFBZSxFQUFFO2dCQUNmLEtBQUss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RjtBQXZtQkQsNEJBdW1CQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHBhdGggZnJvbSBcInBhdGhcIjtcbmltcG9ydCAqIGFzIGNkayBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY29nbml0b1wiO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSBcImF3cy1jZGstbGliL2F3cy1keW5hbW9kYlwiO1xuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZXZlbnRzXCI7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGFcIjtcbmltcG9ydCAqIGFzIGxhbWJkYU5vZGVqcyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSBcImF3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5XCI7XG5pbXBvcnQgKiBhcyBzcXMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1ldmVudHMtdGFyZ2V0c1wiO1xuaW1wb3J0ICogYXMgbGFtYmRhRXZlbnRTb3VyY2VzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLWV2ZW50LXNvdXJjZXNcIjtcbi8vIGltcHBvcnRzIHBhcmEgZnJvbnRlbmQgeSBzMyBlc3RlIGNvZGlnbyBubyBlcyBhdXRvZ2VuZXJhZG9cbmltcG9ydCAqIGFzIHMzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtczNcIjtcbmltcG9ydCAqIGFzIGNsb3VkZnJvbnQgZnJvbSBcImF3cy1jZGstbGliL2F3cy1jbG91ZGZyb250XCI7XG5pbXBvcnQgKiBhcyBvcmlnaW5zIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udC1vcmlnaW5zXCI7XG5pbXBvcnQgKiBhcyBzM2RlcGxveSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnRcIjtcblxuZXhwb3J0IGNsYXNzIENka1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgZXZlbnRCdXMgPSBuZXcgZXZlbnRzLkV2ZW50QnVzKHRoaXMsIFwiQWlyYm5iRXZlbnRCdXNcIik7XG5cbiAgICBjb25zdCBub3RpZmljYXRpb25EbHEgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsIFwiTm90aWZpY2F0aW9uRExRXCIsIHtcbiAgICAgIHJldGVudGlvblBlcmlvZDogY2RrLkR1cmF0aW9uLmRheXMoMTQpLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgIH0pO1xuXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uUXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsIFwiTm90aWZpY2F0aW9uUXVldWVcIiwge1xuICAgICAgdmlzaWJpbGl0eVRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICAgIHJldGVudGlvblBlcmlvZDogY2RrLkR1cmF0aW9uLmRheXMoNCksXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHtcbiAgICAgICAgcXVldWU6IG5vdGlmaWNhdGlvbkRscSxcbiAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiAzXG4gICAgICB9LFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgIH0pO1xuXG4gICAgbmV3IGV2ZW50cy5SdWxlKHRoaXMsIFwiTm90aWZpY2F0aW9uRXZlbnRzUnVsZVwiLCB7XG4gICAgZXZlbnRCdXMsXG4gICAgZXZlbnRQYXR0ZXJuOiB7XG4gICAgICBzb3VyY2U6IFtcbiAgICAgICAgXCJhdXRoLnNlcnZpY2VcIixcbiAgICAgICAgXCJ1c2VyLnNlcnZpY2VcIixcbiAgICAgICAgXCJsaXN0aW5nLnNlcnZpY2VcIixcbiAgICAgICAgXCJib29raW5nLnNlcnZpY2VcIixcbiAgICAgICAgXCJyZXZpZXcuc2VydmljZVwiXG4gICAgICBdLFxuICAgICAgZGV0YWlsVHlwZTogW1xuICAgICAgICBcInVzZXIuY3JlYXRlZFwiLFxuICAgICAgICBcImxpc3RpbmcuY3JlYXRlZFwiLFxuICAgICAgICBcImJvb2tpbmcuY3JlYXRlZFwiLFxuICAgICAgICBcInJldmlldy5jcmVhdGVkXCJcbiAgICAgIF1cbiAgICB9LFxuICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5TcXNRdWV1ZShub3RpZmljYXRpb25RdWV1ZSldXG4gIH0pO1xuXG4gICAgLy8gQ29nbml0byBVc2VyIFBvb2xcbiAgICBjb25zdCB1c2VyUG9vbCA9IG5ldyBjb2duaXRvLlVzZXJQb29sKHRoaXMsIFwiVXNlclBvb2xcIiwge1xuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXG4gICAgICBzaWduSW5BbGlhc2VzOiB7IGVtYWlsOiB0cnVlIH0sXG4gICAgICBhdXRvVmVyaWZ5OiB7IGVtYWlsOiB0cnVlIH0sXG4gICAgICBwYXNzd29yZFBvbGljeToge1xuICAgICAgICBtaW5MZW5ndGg6IDgsXG4gICAgICAgIHJlcXVpcmVMb3dlcmNhc2U6IHRydWUsXG4gICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXG4gICAgICAgIHJlcXVpcmVEaWdpdHM6IHRydWVcbiAgICAgIH0sXG4gICAgICBjdXN0b21BdHRyaWJ1dGVzOiB7XG4gICAgICAgIHJvbGU6IG5ldyBjb2duaXRvLlN0cmluZ0F0dHJpYnV0ZSh7IG11dGFibGU6IHRydWUgfSlcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIENvZ25pdG8gQXBwIENsaWVudFxuICAgIGNvbnN0IHVzZXJQb29sQ2xpZW50ID0gbmV3IGNvZ25pdG8uVXNlclBvb2xDbGllbnQodGhpcywgXCJVc2VyUG9vbENsaWVudFwiLCB7XG4gICAgICB1c2VyUG9vbCxcbiAgICAgIGF1dGhGbG93czoge1xuICAgICAgICB1c2VyUGFzc3dvcmQ6IHRydWUsXG4gICAgICAgIHVzZXJTcnA6IHRydWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIER5bmFtb0RCIFRhYmxlXG4gICAgY29uc3QgdXNlcnNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCBcIlVzZXJzVGFibGVcIiwge1xuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwiZW1haWxcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZIC8vIHNvbG8gcGFyYSBkZW1vXG4gICAgfSk7XG5cbiAgICBjb25zdCBsaXN0aW5nc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsIFwiTGlzdGluZ3NUYWJsZVwiLCB7XG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJsaXN0aW5nSWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1RcbiAgICB9KTtcblxuICAgIGxpc3RpbmdzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiBcIm93bmVySWQtaW5kZXhcIixcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcIm93bmVySWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgYm9va2luZ3NUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCBcIkJvb2tpbmdzVGFibGVcIiwge1xuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwiYm9va2luZ0lkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNUXG4gICAgfSk7XG5cbiAgICBib29raW5nc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogXCJndWVzdElkLWluZGV4XCIsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJndWVzdElkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH1cbiAgICB9KTtcblxuICAgIGJvb2tpbmdzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiBcImxpc3RpbmdJZC1pbmRleFwiLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwibGlzdGluZ0lkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IHJldmlld3NUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCBcIlJldmlld3NUYWJsZVwiLCB7XG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJyZXZpZXdJZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVFxuICAgIH0pO1xuXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsIFwiTm90aWZpY2F0aW9uc1RhYmxlXCIsIHtcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcIm5vdGlmaWNhdGlvbklkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgIH0pO1xuXG4gICAgcmV2aWV3c1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogXCJsaXN0aW5nSWQtaW5kZXhcIixcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcImxpc3RpbmdJZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9XG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGFcbiAgICBjb25zdCBzZXJ2aWNlc1Jvb3QgPSBwYXRoLmpvaW4oX19kaXJuYW1lLCBcIi4uLy4uL2FpcmJuYl9ncm91cF9zZXJ2aWNlc1wiKTtcbiAgICBjb25zdCBmcm9udGVuZFVybCA9IHByb2Nlc3MuZW52LkZST05URU5EX1VSTCE7XG5cbiAgICBjb25zdCBhdXRoUmVnaXN0ZXJMYW1iZGEgPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsIFwiQXV0aFJlZ2lzdGVyTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL2F1dGgtc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJyZWdpc3RlclwiLFxuICAgICAgcHJvamVjdFJvb3Q6IHNlcnZpY2VzUm9vdCxcbiAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwicGFja2FnZS1sb2NrLmpzb25cIiksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBVU0VSX1BPT0xfQ0xJRU5UX0lEOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICBGUk9OVEVORF9VUkw6IGZyb250ZW5kVXJsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBhdXRoQ29uZmlybUxhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJBdXRoQ29uZmlybUxhbWJkYVwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oXG4gICAgICAgIHNlcnZpY2VzUm9vdCxcbiAgICAgICAgXCJzZXJ2aWNlcy9hdXRoLXNlcnZpY2Uvc3JjL2hhbmRsZXIudHNcIlxuICAgICAgKSxcbiAgICAgIGhhbmRsZXI6IFwiY29uZmlybVwiLFxuICAgICAgcHJvamVjdFJvb3Q6IHNlcnZpY2VzUm9vdCxcbiAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwicGFja2FnZS1sb2NrLmpzb25cIiksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBVU0VSX1BPT0xfQ0xJRU5UX0lEOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICBVU0VSX1BPT0xfSUQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICAgIFVTRVJTX1RBQkxFOiB1c2Vyc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcbiAgICAgICAgRlJPTlRFTkRfVVJMOiBmcm9udGVuZFVybFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgYXV0aExvZ2luTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBcIkF1dGhMb2dpbkxhbWJkYVwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oXG4gICAgICAgIHNlcnZpY2VzUm9vdCxcbiAgICAgICAgXCJzZXJ2aWNlcy9hdXRoLXNlcnZpY2Uvc3JjL2hhbmRsZXIudHNcIlxuICAgICAgKSxcbiAgICAgIGhhbmRsZXI6IFwibG9naW5cIixcbiAgICAgIHByb2plY3RSb290OiBzZXJ2aWNlc1Jvb3QsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInBhY2thZ2UtbG9jay5qc29uXCIpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgVVNFUl9QT09MX0NMSUVOVF9JRDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgICAgVVNFUl9QT09MX0lEOiB1c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgICBVU0VSU19UQUJMRTogdXNlcnNUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIEZST05URU5EX1VSTDogZnJvbnRlbmRVcmxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IGF1dGhSZWZyZXNoTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBcIkF1dGhSZWZyZXNoTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL2F1dGgtc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJyZWZyZXNoXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFVTRVJfUE9PTF9DTElFTlRfSUQ6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICAgIFVTRVJTX1RBQkxFOiB1c2Vyc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRlJPTlRFTkRfVVJMOiBmcm9udGVuZFVybFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgYXV0aExvZ291dExhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJBdXRoTG9nb3V0TGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL2F1dGgtc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJsb2dvdXRcIixcbiAgICAgIHByb2plY3RSb290OiBzZXJ2aWNlc1Jvb3QsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInBhY2thZ2UtbG9jay5qc29uXCIpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgRlJPTlRFTkRfVVJMOiBmcm9udGVuZFVybFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgdXNlckxhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJVc2VyTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL3VzZXItc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJjcmVhdGVVc2VyXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFVTRVJTX1RBQkxFOiB1c2Vyc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcbiAgICAgICAgRlJPTlRFTkRfVVJMOiBmcm9udGVuZFVybFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgbGlzdGluZ0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJMaXN0aW5nTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL2xpc3Rpbmctc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJjcmVhdGVMaXN0aW5nXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIExJU1RJTkdTX1RBQkxFOiBsaXN0aW5nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcbiAgICAgICAgRlJPTlRFTkRfVVJMOiBmcm9udGVuZFVybFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgZ2V0TGlzdGluZ3NMYW1iZGEgPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsIFwiR2V0TGlzdGluZ3NMYW1iZGFcIiwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJzZXJ2aWNlcy9saXN0aW5nLXNlcnZpY2Uvc3JjL2hhbmRsZXIudHNcIiksXG4gICAgICBoYW5kbGVyOiBcImdldExpc3RpbmdzQnlPd25lclwiLFxuICAgICAgcHJvamVjdFJvb3Q6IHNlcnZpY2VzUm9vdCxcbiAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwicGFja2FnZS1sb2NrLmpzb25cIiksXG4gICAgICBlbnZpcm9ubWVudDogeyBcbiAgICAgICAgTElTVElOR1NfVEFCTEU6IGxpc3RpbmdzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBGUk9OVEVORF9VUkw6IGZyb250ZW5kVXJsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBnZXRBbGxMaXN0aW5nc0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJHZXRBbGxMaXN0aW5nc0xhbWJkYVwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInNlcnZpY2VzL2xpc3Rpbmctc2VydmljZS9zcmMvaGFuZGxlci50c1wiKSxcbiAgICAgIGhhbmRsZXI6IFwiZ2V0QWxsTGlzdGluZ3NcIixcbiAgICAgIHByb2plY3RSb290OiBzZXJ2aWNlc1Jvb3QsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInBhY2thZ2UtbG9jay5qc29uXCIpLFxuICAgICAgZW52aXJvbm1lbnQ6IHsgXG4gICAgICAgIExJU1RJTkdTX1RBQkxFOiBsaXN0aW5nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRlJPTlRFTkRfVVJMOiBmcm9udGVuZFVybFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgYm9va2luZ0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJCb29raW5nTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL2Jvb2tpbmctc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJjcmVhdGVCb29raW5nXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIEJPT0tJTkdTX1RBQkxFOiBib29raW5nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcbiAgICAgICAgRlJPTlRFTkRfVVJMOiBmcm9udGVuZFVybFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgZ2V0Qm9va2luZ3NMYW1iZGEgPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsIFwiR2V0Qm9va2luZ3NMYW1iZGFcIiwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJzZXJ2aWNlcy9ib29raW5nLXNlcnZpY2Uvc3JjL2hhbmRsZXIudHNcIiksXG4gICAgICBoYW5kbGVyOiBcImdldEJvb2tpbmdzQnlHdWVzdFwiLFxuICAgICAgcHJvamVjdFJvb3Q6IHNlcnZpY2VzUm9vdCxcbiAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwicGFja2FnZS1sb2NrLmpzb25cIiksXG4gICAgICBlbnZpcm9ubWVudDogeyBcbiAgICAgICAgQk9PS0lOR1NfVEFCTEU6IGJvb2tpbmdzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBGUk9OVEVORF9VUkw6IGZyb250ZW5kVXJsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBnZXRCb29raW5nc0J5TGlzdGluZ0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJHZXRCb29raW5nc0J5TGlzdGluZ0xhbWJkYVwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInNlcnZpY2VzL2Jvb2tpbmctc2VydmljZS9zcmMvaGFuZGxlci50c1wiKSxcbiAgICAgIGhhbmRsZXI6IFwiZ2V0Qm9va2luZ3NCeUxpc3RpbmdcIixcbiAgICAgIHByb2plY3RSb290OiBzZXJ2aWNlc1Jvb3QsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInBhY2thZ2UtbG9jay5qc29uXCIpLFxuICAgICAgZW52aXJvbm1lbnQ6IHsgXG4gICAgICAgIEJPT0tJTkdTX1RBQkxFOiBib29raW5nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRlJPTlRFTkRfVVJMOiBmcm9udGVuZFVybFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgZ2V0Qm9va2luZ0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJHZXRCb29raW5nTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL2Jvb2tpbmctc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJnZXRCb29raW5nQnlJZFwiLFxuICAgICAgcHJvamVjdFJvb3Q6IHNlcnZpY2VzUm9vdCxcbiAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwicGFja2FnZS1sb2NrLmpzb25cIiksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBCT09LSU5HU19UQUJMRTogYm9va2luZ3NUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIEZST05URU5EX1VSTDogZnJvbnRlbmRVcmxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IHJldmlld0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJSZXZpZXdMYW1iZGFcIiwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKFxuICAgICAgICBzZXJ2aWNlc1Jvb3QsXG4gICAgICAgIFwic2VydmljZXMvcmV2aWV3LXNlcnZpY2Uvc3JjL2hhbmRsZXIudHNcIlxuICAgICAgKSxcbiAgICAgIGhhbmRsZXI6IFwiY3JlYXRlUmV2aWV3XCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFJFVklFV1NfVEFCTEU6IHJldmlld3NUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIEVWRU5UX0JVU19OQU1FOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXG4gICAgICAgIEZST05URU5EX1VSTDogZnJvbnRlbmRVcmxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IGdldFJldmlld3NMYW1iZGEgPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsIFwiR2V0UmV2aWV3c0xhbWJkYVwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oXG4gICAgICAgIHNlcnZpY2VzUm9vdCxcbiAgICAgICAgXCJzZXJ2aWNlcy9yZXZpZXctc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJnZXRSZXZpZXdzQnlMaXN0aW5nXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFJFVklFV1NfVEFCTEU6IHJldmlld3NUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIEZST05URU5EX1VSTDogZnJvbnRlbmRVcmxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IG5vdGlmaWNhdGlvbkxhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJOb3RpZmljYXRpb25MYW1iZGFcIiwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKFxuICAgICAgICBzZXJ2aWNlc1Jvb3QsXG4gICAgICAgIFwic2VydmljZXMvbm90aWZpY2F0aW9uLXNlcnZpY2Uvc3JjL2hhbmRsZXIudHNcIlxuICAgICAgKSxcbiAgICAgIGhhbmRsZXI6IFwiaGFuZGxlVXNlckNyZWF0ZWRcIixcbiAgICAgIHByb2plY3RSb290OiBzZXJ2aWNlc1Jvb3QsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInBhY2thZ2UtbG9jay5qc29uXCIpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgTk9USUZJQ0FUSU9OU19UQUJMRTogbm90aWZpY2F0aW9uc1RhYmxlLnRhYmxlTmFtZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgbm90aWZpY2F0aW9uTGFtYmRhLmFkZEV2ZW50U291cmNlKFxuICAgICAgbmV3IGxhbWJkYUV2ZW50U291cmNlcy5TcXNFdmVudFNvdXJjZShub3RpZmljYXRpb25RdWV1ZSwge1xuICAgICAgICBiYXRjaFNpemU6IDUsXG4gICAgICAgIHJlcG9ydEJhdGNoSXRlbUZhaWx1cmVzOiB0cnVlXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBQZXJtaXNvc1xuICAgIHVzZXJzVGFibGUuZ3JhbnRXcml0ZURhdGEodXNlckxhbWJkYSk7XG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyh1c2VyTGFtYmRhKTtcbiAgICBsaXN0aW5nc1RhYmxlLmdyYW50V3JpdGVEYXRhKGxpc3RpbmdMYW1iZGEpO1xuICAgIGV2ZW50QnVzLmdyYW50UHV0RXZlbnRzVG8obGlzdGluZ0xhbWJkYSk7XG4gICAgYm9va2luZ3NUYWJsZS5ncmFudFdyaXRlRGF0YShib29raW5nTGFtYmRhKTtcbiAgICBib29raW5nc1RhYmxlLmdyYW50UmVhZERhdGEoZ2V0Qm9va2luZ0xhbWJkYSk7XG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyhib29raW5nTGFtYmRhKTtcbiAgICByZXZpZXdzVGFibGUuZ3JhbnRXcml0ZURhdGEocmV2aWV3TGFtYmRhKTtcbiAgICByZXZpZXdzVGFibGUuZ3JhbnRSZWFkRGF0YShnZXRSZXZpZXdzTGFtYmRhKTtcbiAgICBldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKHJldmlld0xhbWJkYSk7XG4gICAgbm90aWZpY2F0aW9uc1RhYmxlLmdyYW50V3JpdGVEYXRhKG5vdGlmaWNhdGlvbkxhbWJkYSk7XG4gICAgdXNlcnNUYWJsZS5ncmFudFdyaXRlRGF0YShhdXRoQ29uZmlybUxhbWJkYSk7XG4gICAgdXNlcnNUYWJsZS5ncmFudFJlYWREYXRhKGF1dGhMb2dpbkxhbWJkYSk7XG4gICAgdXNlcnNUYWJsZS5ncmFudFJlYWREYXRhKGF1dGhSZWZyZXNoTGFtYmRhKTtcbiAgICBldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKGF1dGhDb25maXJtTGFtYmRhKTtcbiAgICBsaXN0aW5nc1RhYmxlLmdyYW50UmVhZERhdGEoZ2V0TGlzdGluZ3NMYW1iZGEpO1xuICAgIGxpc3RpbmdzVGFibGUuZ3JhbnRSZWFkRGF0YShnZXRBbGxMaXN0aW5nc0xhbWJkYSk7XG4gICAgYm9va2luZ3NUYWJsZS5ncmFudFJlYWREYXRhKGdldEJvb2tpbmdzTGFtYmRhKTtcbiAgICBib29raW5nc1RhYmxlLmdyYW50UmVhZERhdGEoZ2V0Qm9va2luZ3NCeUxpc3RpbmdMYW1iZGEpO1xuXG5cbiAgICBhdXRoQ29uZmlybUxhbWJkYS5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgY2RrLmF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1wiY29nbml0by1pZHA6QWRtaW5HZXRVc2VyXCJdLFxuICAgICAgICByZXNvdXJjZXM6IFt1c2VyUG9vbC51c2VyUG9vbEFybl1cbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIEFQSSBHYXRld2F5XG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCBcIkFpcmJuYkFwaVwiLCB7XG4gICAgICByZXN0QXBpTmFtZTogXCJBaXJibmIgU2VydmljZVwiLFxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XG4gICAgICAgIGFsbG93T3JpZ2luczogW2Zyb250ZW5kVXJsXSxcbiAgICAgICAgYWxsb3dNZXRob2RzOiBhcGlnYXRld2F5LkNvcnMuQUxMX01FVEhPRFMsXG4gICAgICAgIGFsbG93SGVhZGVyczogW1wiQ29udGVudC1UeXBlXCIsIFwiWC1BbXotRGF0ZVwiLCBcIkF1dGhvcml6YXRpb25cIiwgXCJYLUFwaS1LZXlcIiwgXCJYLUFtei1TZWN1cml0eS1Ub2tlblwiXSxcbiAgICAgICAgYWxsb3dDcmVkZW50aWFsczogdHJ1ZSxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIENvZ25pdG8gQXV0aG9yaXplclxuICAgIGNvbnN0IGF1dGhvcml6ZXIgPSBuZXcgYXBpZ2F0ZXdheS5Db2duaXRvVXNlclBvb2xzQXV0aG9yaXplcih0aGlzLCBcIkF1dGhvcml6ZXJcIiwge1xuICAgICAgY29nbml0b1VzZXJQb29sczogW3VzZXJQb29sXVxuICAgIH0pO1xuXG4gICAgY29uc3QgdjEgPSBhcGkucm9vdC5hZGRSZXNvdXJjZShcInYxXCIpO1xuXG4gICAgY29uc3QgYXV0aCA9IHYxLmFkZFJlc291cmNlKFwiYXV0aFwiKTtcblxuICAgIGF1dGguYWRkUmVzb3VyY2UoXCJyZWdpc3RlclwiKS5hZGRNZXRob2QoXG4gICAgICBcIlBPU1RcIixcbiAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGF1dGhSZWdpc3RlckxhbWJkYSlcbiAgICApO1xuXG4gICAgYXV0aC5hZGRSZXNvdXJjZShcImNvbmZpcm1cIikuYWRkTWV0aG9kKFxuICAgICAgXCJQT1NUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihhdXRoQ29uZmlybUxhbWJkYSlcbiAgICApO1xuXG4gICAgYXV0aC5hZGRSZXNvdXJjZShcImxvZ2luXCIpLmFkZE1ldGhvZChcbiAgICAgIFwiUE9TVFwiLFxuICAgICAgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oYXV0aExvZ2luTGFtYmRhKVxuICAgICk7XG5cbiAgICBhdXRoLmFkZFJlc291cmNlKFwicmVmcmVzaFwiKS5hZGRNZXRob2QoXG4gICAgICBcIlBPU1RcIixcbiAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGF1dGhSZWZyZXNoTGFtYmRhKVxuICAgICk7XG5cbiAgICBhdXRoLmFkZFJlc291cmNlKFwibG9nb3V0XCIpLmFkZE1ldGhvZChcbiAgICAgIFwiUE9TVFwiLFxuICAgICAgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oYXV0aExvZ291dExhbWJkYSlcbiAgICApO1xuXG4gICAgY29uc3QgdXNlcnMgPSB2MS5hZGRSZXNvdXJjZShcInVzZXJzXCIpO1xuXG4gICAgdXNlcnMuYWRkTWV0aG9kKFxuICAgICAgXCJQT1NUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbih1c2VyTGFtYmRhKSxcbiAgICAgIHtcbiAgICAgICAgYXV0aG9yaXplcixcbiAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgICAgfVxuICAgICk7XG5cbiAgICBjb25zdCBsaXN0aW5ncyA9IHYxLmFkZFJlc291cmNlKFwibGlzdGluZ3NcIik7XG5cbiAgICBsaXN0aW5ncy5hZGRNZXRob2QoXG4gICAgICBcIlBPU1RcIixcbiAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGxpc3RpbmdMYW1iZGEpLFxuICAgICAge1xuICAgICAgICBhdXRob3JpemVyLFxuICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPXG4gICAgICB9XG4gICAgKTtcblxuICAgIGxpc3RpbmdzLmFkZFJlc291cmNlKFwibXlcIikuYWRkTWV0aG9kKFxuICAgICAgXCJHRVRcIixcbiAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGdldExpc3RpbmdzTGFtYmRhKSxcbiAgICAgIHsgYXV0aG9yaXplciwgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUTyB9XG4gICAgKTtcblxuICAgIGxpc3RpbmdzLmFkZE1ldGhvZChcbiAgICAgIFwiR0VUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihnZXRBbGxMaXN0aW5nc0xhbWJkYSlcbiAgICAgIC8vIFNpbiBhdXRob3JpemVyIOKAlCBlbmRwb2ludCBww7pibGljb1xuICAgICk7XG5cbiAgICBjb25zdCBib29raW5ncyA9IHYxLmFkZFJlc291cmNlKFwiYm9va2luZ3NcIik7XG5cbiAgICBib29raW5ncy5hZGRNZXRob2QoXG4gICAgICBcIlBPU1RcIixcbiAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGJvb2tpbmdMYW1iZGEpLFxuICAgICAge1xuICAgICAgICBhdXRob3JpemVyLFxuICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPXG4gICAgICB9XG4gICAgKTtcblxuICAgIGNvbnN0IGJvb2tpbmdCeUlkID0gYm9va2luZ3MuYWRkUmVzb3VyY2UoXCJ7Ym9va2luZ0lkfVwiKTtcblxuICAgIGJvb2tpbmdCeUlkLmFkZE1ldGhvZChcbiAgICAgIFwiR0VUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihnZXRCb29raW5nTGFtYmRhKSxcbiAgICAgIHtcbiAgICAgICAgYXV0aG9yaXplcixcbiAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgICAgfVxuICAgICk7XG5cbiAgICBib29raW5ncy5hZGRSZXNvdXJjZShcIm15XCIpLmFkZE1ldGhvZChcbiAgICAgIFwiR0VUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihnZXRCb29raW5nc0xhbWJkYSksXG4gICAgICB7IGF1dGhvcml6ZXIsIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8gfVxuICAgICk7XG5cbiAgICBjb25zdCBsaXN0aW5nQm9va2luZ3MgPSBsaXN0aW5ncy5hZGRSZXNvdXJjZShcIntsaXN0aW5nSWR9XCIpLmFkZFJlc291cmNlKFwiYm9va2luZ3NcIik7XG4gICAgbGlzdGluZ0Jvb2tpbmdzLmFkZE1ldGhvZChcbiAgICAgIFwiR0VUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihnZXRCb29raW5nc0J5TGlzdGluZ0xhbWJkYSksXG4gICAgICB7IGF1dGhvcml6ZXIsIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8gfVxuICAgICk7XG4gICAgY29uc3QgcmV2aWV3cyA9IHYxLmFkZFJlc291cmNlKFwicmV2aWV3c1wiKTtcblxuICAgIHJldmlld3MuYWRkTWV0aG9kKFwiUE9TVFwiLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihyZXZpZXdMYW1iZGEpLCB7XG4gICAgICBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuXG4gICAgY29uc3QgcmV2aWV3c0J5TGlzdGluZyA9IHJldmlld3MuYWRkUmVzb3VyY2UoXCJsaXN0aW5nXCIpLmFkZFJlc291cmNlKFwie2xpc3RpbmdJZH1cIik7XG5cbiAgICByZXZpZXdzQnlMaXN0aW5nLmFkZE1ldGhvZChcbiAgICAgIFwiR0VUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihnZXRSZXZpZXdzTGFtYmRhKSxcbiAgICAgIHtcbiAgICAgICAgYXV0aG9yaXplcixcbiAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBTMyBCdWNrZXQgcGFyYSBob3N0aW5nIGZyb250ZW5kXG4gICAgY29uc3QgZnJvbnRlbmREaXN0UGF0aCA9IHBhdGguam9pbihcbiAgICAgIF9fZGlybmFtZSxcbiAgICAgIFwiLi4vLi4vYWlyYm5iX2dyb3VwX2Zyb250L2Rpc3RcIlxuICAgICk7XG5cbiAgICBjb25zdCBmcm9udGVuZEJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgXCJGcm9udGVuZEJ1Y2tldFwiLCB7XG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlXG4gICAgfSk7XG5cbiAgICBjb25zdCBzcGFSb3V0aW5nRnVuY3Rpb24gPSBuZXcgY2xvdWRmcm9udC5GdW5jdGlvbih0aGlzLCBcIlNwYVJvdXRpbmdGdW5jdGlvblwiLCB7XG4gICAgICBjb2RlOiBjbG91ZGZyb250LkZ1bmN0aW9uQ29kZS5mcm9tSW5saW5lKGBcbmZ1bmN0aW9uIGhhbmRsZXIoZXZlbnQpIHtcbiAgdmFyIHJlcXVlc3QgPSBldmVudC5yZXF1ZXN0O1xuICB2YXIgdXJpID0gcmVxdWVzdC51cmk7XG5cbiAgaWYgKHVyaSAhPT0gXCIvXCIgJiYgIXVyaS5pbmNsdWRlcyhcIi5cIikpIHtcbiAgICByZXF1ZXN0LnVyaSA9IFwiL2luZGV4Lmh0bWxcIjtcbiAgfVxuXG4gIHJldHVybiByZXF1ZXN0O1xufVxuYClcbiAgICB9KTtcblxuICAgIGNvbnN0IGRpc3RyaWJ1dGlvbiA9IG5ldyBjbG91ZGZyb250LkRpc3RyaWJ1dGlvbih0aGlzLCBcIkZyb250ZW5kRGlzdHJpYnV0aW9uXCIsIHtcbiAgICAgIGRlZmF1bHRCZWhhdmlvcjoge1xuICAgICAgICBvcmlnaW46IG9yaWdpbnMuUzNCdWNrZXRPcmlnaW4ud2l0aE9yaWdpbkFjY2Vzc0NvbnRyb2woZnJvbnRlbmRCdWNrZXQpLFxuICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgZnVuY3Rpb25Bc3NvY2lhdGlvbnM6IFt7XG4gICAgICAgICAgZXZlbnRUeXBlOiBjbG91ZGZyb250LkZ1bmN0aW9uRXZlbnRUeXBlLlZJRVdFUl9SRVFVRVNULFxuICAgICAgICAgIGZ1bmN0aW9uOiBzcGFSb3V0aW5nRnVuY3Rpb25cbiAgICAgICAgfV1cbiAgICAgIH0sXG4gICAgICBkZWZhdWx0Um9vdE9iamVjdDogXCJpbmRleC5odG1sXCJcbiAgICB9KTtcblxuICAgIGRpc3RyaWJ1dGlvbi5hZGRCZWhhdmlvcihcIi92MS8qXCIsIG5ldyBvcmlnaW5zLlJlc3RBcGlPcmlnaW4oYXBpKSwge1xuICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19BTEwsXG4gICAgICBjYWNoZVBvbGljeTogY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX0RJU0FCTEVELFxuICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTogY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5LkFMTF9WSUVXRVJfRVhDRVBUX0hPU1RfSEVBREVSLFxuICAgIH0pO1xuXG4gICAgbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgXCJEZXBsb3lGcm9udGVuZFwiLCB7XG4gICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmFzc2V0KGZyb250ZW5kRGlzdFBhdGgpXSxcbiAgICAgIGRlc3RpbmF0aW9uQnVja2V0OiBmcm9udGVuZEJ1Y2tldCxcbiAgICAgIGRpc3RyaWJ1dGlvbixcbiAgICAgIGRpc3RyaWJ1dGlvblBhdGhzOiBbXCIvKlwiXVxuICAgIH0pO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiVXNlclBvb2xJZFwiLCB7XG4gICAgICB2YWx1ZTogdXNlclBvb2wudXNlclBvb2xJZFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJVc2VyUG9vbENsaWVudElkXCIsIHtcbiAgICAgIHZhbHVlOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFwaVVybFwiLCB7XG4gICAgICB2YWx1ZTogYXBpLnVybFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJFdmVudEJ1c05hbWVcIiwge1xuICAgICAgdmFsdWU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZVxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJOb3RpZmljYXRpb25RdWV1ZVVybFwiLCB7XG4gICAgICB2YWx1ZTogbm90aWZpY2F0aW9uUXVldWUucXVldWVVcmxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTm90aWZpY2F0aW9uRExRVXJsXCIsIHtcbiAgICAgIHZhbHVlOiBub3RpZmljYXRpb25EbHEucXVldWVVcmxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTm90aWZpY2F0aW9uRExRTmFtZVwiLCB7XG4gICAgICB2YWx1ZTogbm90aWZpY2F0aW9uRGxxLnF1ZXVlTmFtZVxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJOb3RpZmljYXRpb25RdWV1ZU5hbWVcIiwge1xuICAgICAgdmFsdWU6IG5vdGlmaWNhdGlvblF1ZXVlLnF1ZXVlTmFtZVxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJOb3RpZmljYXRpb25zVGFibGVOYW1lXCIsIHtcbiAgICAgIHZhbHVlOiBub3RpZmljYXRpb25zVGFibGUudGFibGVOYW1lXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkZyb250ZW5kVXJsXCIsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke2Rpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lfWBcbiAgICB9KTtcbiAgfVxufVxuIl19
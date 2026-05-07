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
        const bookingsTable = new dynamodb.Table(this, "BookingsTable", {
            partitionKey: { name: "bookingId", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
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
        const authRegisterLambda = new lambdaNodejs.NodejsFunction(this, "AuthRegisterLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/auth-service/src/handler.ts"),
            handler: "register",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId
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
                EVENT_BUS_NAME: eventBus.eventBusName
            }
        });
        const authLoginLambda = new lambdaNodejs.NodejsFunction(this, "AuthLoginLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/auth-service/src/handler.ts"),
            handler: "login",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId
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
                EVENT_BUS_NAME: eventBus.eventBusName
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
                EVENT_BUS_NAME: eventBus.eventBusName
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
                EVENT_BUS_NAME: eventBus.eventBusName
            }
        });
        const getBookingLambda = new lambdaNodejs.NodejsFunction(this, "GetBookingLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/booking-service/src/handler.ts"),
            handler: "getBookingById",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                BOOKINGS_TABLE: bookingsTable.tableName
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
                EVENT_BUS_NAME: eventBus.eventBusName
            }
        });
        const getReviewsLambda = new lambdaNodejs.NodejsFunction(this, "GetReviewsLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/review-service/src/handler.ts"),
            handler: "getReviewsByListing",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
            environment: {
                REVIEWS_TABLE: reviewsTable.tableName
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
        eventBus.grantPutEventsTo(authConfirmLambda);
        authConfirmLambda.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: ["cognito-idp:AdminGetUser"],
            resources: [userPool.userPoolArn]
        }));
        // API Gateway
        const api = new apigateway.RestApi(this, "AirbnbApi", {
            restApiName: "Airbnb Service",
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
    }
}
exports.CdkStack = CdkStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2RrLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY2RrLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZCQUE2QjtBQUM3QixtQ0FBbUM7QUFFbkMsbURBQW1EO0FBQ25ELHFEQUFxRDtBQUNyRCxpREFBaUQ7QUFDakQsaURBQWlEO0FBQ2pELDhEQUE4RDtBQUM5RCx5REFBeUQ7QUFDekQsMkNBQTJDO0FBQzNDLDBEQUEwRDtBQUMxRCwyRUFBMkU7QUFFM0UsTUFBYSxRQUFTLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDckMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLFFBQVEsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGdCQUFnQixDQUFDLENBQUM7UUFFN0QsTUFBTSxlQUFlLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUM3RCxlQUFlLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ3RDLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87U0FDekMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQ2pFLGlCQUFpQixFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUMzQyxlQUFlLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1lBQ3JDLGVBQWUsRUFBRTtnQkFDZixLQUFLLEVBQUUsZUFBZTtnQkFDdEIsZUFBZSxFQUFFLENBQUM7YUFDbkI7WUFDRCxhQUFhLEVBQUUsR0FBRyxDQUFDLGFB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QUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFFO1lBQzlDLEtBQUssRUFBRSxpQkFBaUIsQ0FBQyxRQUFRO1NBQ2xDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDNUMsS0FBSyxFQUFFLGVBQWUsQ0FBQyxRQUFRO1NBQ2hDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDN0MsS0FBSyxFQUFFLGVBQWUsQ0FBQyxTQUFTO1NBQ2pDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDL0MsS0FBSyxFQUFFLGlCQUFpQixDQUFDLFNBQVM7U0FDbkMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSx3QkFBd0IsRUFBRTtZQUNoRCxLQUFLLEVBQUUsa0JBQWtCLENBQUMsU0FBUztTQUNwQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFwWkQsNEJBb1pDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSBcImF3cy1jZGstbGliL2F3cy1jb2duaXRvXCI7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiXCI7XG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1ldmVudHNcIjtcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYVwiO1xuaW1wb3J0ICogYXMgbGFtYmRhTm9kZWpzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcbmltcG9ydCAqIGFzIHNxcyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNxc1wiO1xuaW1wb3J0ICogYXMgdGFyZ2V0cyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzXCI7XG5pbXBvcnQgKiBhcyBsYW1iZGFFdmVudFNvdXJjZXMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtZXZlbnQtc291cmNlc1wiO1xuXG5leHBvcnQgY2xhc3MgQ2RrU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCBldmVudEJ1cyA9IG5ldyBldmVudHMuRXZlbnRCdXModGhpcywgXCJBaXJibmJFdmVudEJ1c1wiKTtcblxuICAgIGNvbnN0IG5vdGlmaWNhdGlvbkRscSA9IG5ldyBzcXMuUXVldWUodGhpcywgXCJOb3RpZmljYXRpb25ETFFcIiwge1xuICAgICAgcmV0ZW50aW9uUGVyaW9kOiBjZGsuRHVyYXRpb24uZGF5cygxNCksXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgfSk7XG5cbiAgICBjb25zdCBub3RpZmljYXRpb25RdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgXCJOb3RpZmljYXRpb25RdWV1ZVwiLCB7XG4gICAgICB2aXNpYmlsaXR5VGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNjApLFxuICAgICAgcmV0ZW50aW9uUGVyaW9kOiBjZGsuRHVyYXRpb24uZGF5cyg0KSxcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZToge1xuICAgICAgICBxdWV1ZTogbm90aWZpY2F0aW9uRGxxLFxuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDNcbiAgICAgIH0sXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgfSk7XG5cbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgXCJOb3RpZmljYXRpb25FdmVudHNSdWxlXCIsIHtcbiAgICBldmVudEJ1cyxcbiAgICBldmVudFBhdHRlcm46IHtcbiAgICAgIHNvdXJjZTogW1xuICAgICAgICBcImF1dGguc2VydmljZVwiLFxuICAgICAgICBcInVzZXIuc2VydmljZVwiLFxuICAgICAgICBcImxpc3Rpbmcuc2VydmljZVwiLFxuICAgICAgICBcImJvb2tpbmcuc2VydmljZVwiLFxuICAgICAgICBcInJldmlldy5zZXJ2aWNlXCJcbiAgICAgIF0sXG4gICAgICBkZXRhaWxUeXBlOiBbXG4gICAgICAgIFwidXNlci5jcmVhdGVkXCIsXG4gICAgICAgIFwibGlzdGluZy5jcmVhdGVkXCIsXG4gICAgICAgIFwiYm9va2luZy5jcmVhdGVkXCIsXG4gICAgICAgIFwicmV2aWV3LmNyZWF0ZWRcIlxuICAgICAgXVxuICAgIH0sXG4gICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLlNxc1F1ZXVlKG5vdGlmaWNhdGlvblF1ZXVlKV1cbiAgfSk7XG5cbiAgICAvLyBDb2duaXRvIFVzZXIgUG9vbFxuICAgIGNvbnN0IHVzZXJQb29sID0gbmV3IGNvZ25pdG8uVXNlclBvb2wodGhpcywgXCJVc2VyUG9vbFwiLCB7XG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogdHJ1ZSxcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHsgZW1haWw6IHRydWUgfSxcbiAgICAgIGF1dG9WZXJpZnk6IHsgZW1haWw6IHRydWUgfSxcbiAgICAgIHBhc3N3b3JkUG9saWN5OiB7XG4gICAgICAgIG1pbkxlbmd0aDogOCxcbiAgICAgICAgcmVxdWlyZUxvd2VyY2FzZTogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZVVwcGVyY2FzZTogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZURpZ2l0czogdHJ1ZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gQ29nbml0byBBcHAgQ2xpZW50XG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCBcIlVzZXJQb29sQ2xpZW50XCIsIHtcbiAgICAgIHVzZXJQb29sLFxuICAgICAgYXV0aEZsb3dzOiB7XG4gICAgICAgIHVzZXJQYXNzd29yZDogdHJ1ZSxcbiAgICAgICAgdXNlclNycDogdHJ1ZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gRHluYW1vREIgVGFibGVcbiAgICBjb25zdCB1c2Vyc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsIFwiVXNlcnNUYWJsZVwiLCB7XG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJlbWFpbFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1kgLy8gc29sbyBwYXJhIGRlbW9cbiAgICB9KTtcblxuICAgIGNvbnN0IGxpc3RpbmdzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgXCJMaXN0aW5nc1RhYmxlXCIsIHtcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcImxpc3RpbmdJZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVFxuICAgIH0pO1xuXG4gICAgY29uc3QgYm9va2luZ3NUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCBcIkJvb2tpbmdzVGFibGVcIiwge1xuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwiYm9va2luZ0lkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNUXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXZpZXdzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgXCJSZXZpZXdzVGFibGVcIiwge1xuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwicmV2aWV3SWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1RcbiAgICB9KTtcblxuICAgIGNvbnN0IG5vdGlmaWNhdGlvbnNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCBcIk5vdGlmaWNhdGlvbnNUYWJsZVwiLCB7XG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJub3RpZmljYXRpb25JZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1lcbiAgICB9KTtcblxuICAgIHJldmlld3NUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6IFwibGlzdGluZ0lkLWluZGV4XCIsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJsaXN0aW5nSWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfVxuICAgIH0pO1xuXG4gICAgLy8gTGFtYmRhXG4gICAgY29uc3Qgc2VydmljZXNSb290ID0gcGF0aC5qb2luKF9fZGlybmFtZSwgXCIuLi8uLi9haXJibmJfZ3JvdXBfc2VydmljZXNcIik7XG5cbiAgICBjb25zdCBhdXRoUmVnaXN0ZXJMYW1iZGEgPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsIFwiQXV0aFJlZ2lzdGVyTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL2F1dGgtc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJyZWdpc3RlclwiLFxuICAgICAgcHJvamVjdFJvb3Q6IHNlcnZpY2VzUm9vdCxcbiAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwicGFja2FnZS1sb2NrLmpzb25cIiksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBVU0VSX1BPT0xfQ0xJRU5UX0lEOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBhdXRoQ29uZmlybUxhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJBdXRoQ29uZmlybUxhbWJkYVwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oXG4gICAgICAgIHNlcnZpY2VzUm9vdCxcbiAgICAgICAgXCJzZXJ2aWNlcy9hdXRoLXNlcnZpY2Uvc3JjL2hhbmRsZXIudHNcIlxuICAgICAgKSxcbiAgICAgIGhhbmRsZXI6IFwiY29uZmlybVwiLFxuICAgICAgcHJvamVjdFJvb3Q6IHNlcnZpY2VzUm9vdCxcbiAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwicGFja2FnZS1sb2NrLmpzb25cIiksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBVU0VSX1BPT0xfQ0xJRU5UX0lEOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICBVU0VSX1BPT0xfSUQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICAgIFVTRVJTX1RBQkxFOiB1c2Vyc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgYXV0aExvZ2luTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBcIkF1dGhMb2dpbkxhbWJkYVwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oXG4gICAgICAgIHNlcnZpY2VzUm9vdCxcbiAgICAgICAgXCJzZXJ2aWNlcy9hdXRoLXNlcnZpY2Uvc3JjL2hhbmRsZXIudHNcIlxuICAgICAgKSxcbiAgICAgIGhhbmRsZXI6IFwibG9naW5cIixcbiAgICAgIHByb2plY3RSb290OiBzZXJ2aWNlc1Jvb3QsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInBhY2thZ2UtbG9jay5qc29uXCIpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgVVNFUl9QT09MX0NMSUVOVF9JRDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgdXNlckxhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJVc2VyTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL3VzZXItc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJjcmVhdGVVc2VyXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFVTRVJTX1RBQkxFOiB1c2Vyc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgbGlzdGluZ0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJMaXN0aW5nTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL2xpc3Rpbmctc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJjcmVhdGVMaXN0aW5nXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIExJU1RJTkdTX1RBQkxFOiBsaXN0aW5nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgYm9va2luZ0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJCb29raW5nTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL2Jvb2tpbmctc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJjcmVhdGVCb29raW5nXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIEJPT0tJTkdTX1RBQkxFOiBib29raW5nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgZ2V0Qm9va2luZ0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJHZXRCb29raW5nTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL2Jvb2tpbmctc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJnZXRCb29raW5nQnlJZFwiLFxuICAgICAgcHJvamVjdFJvb3Q6IHNlcnZpY2VzUm9vdCxcbiAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwicGFja2FnZS1sb2NrLmpzb25cIiksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBCT09LSU5HU19UQUJMRTogYm9va2luZ3NUYWJsZS50YWJsZU5hbWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IHJldmlld0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJSZXZpZXdMYW1iZGFcIiwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKFxuICAgICAgICBzZXJ2aWNlc1Jvb3QsXG4gICAgICAgIFwic2VydmljZXMvcmV2aWV3LXNlcnZpY2Uvc3JjL2hhbmRsZXIudHNcIlxuICAgICAgKSxcbiAgICAgIGhhbmRsZXI6IFwiY3JlYXRlUmV2aWV3XCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFJFVklFV1NfVEFCTEU6IHJldmlld3NUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIEVWRU5UX0JVU19OQU1FOiBldmVudEJ1cy5ldmVudEJ1c05hbWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IGdldFJldmlld3NMYW1iZGEgPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsIFwiR2V0UmV2aWV3c0xhbWJkYVwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oXG4gICAgICAgIHNlcnZpY2VzUm9vdCxcbiAgICAgICAgXCJzZXJ2aWNlcy9yZXZpZXctc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJnZXRSZXZpZXdzQnlMaXN0aW5nXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFJFVklFV1NfVEFCTEU6IHJldmlld3NUYWJsZS50YWJsZU5hbWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IG5vdGlmaWNhdGlvbkxhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJOb3RpZmljYXRpb25MYW1iZGFcIiwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKFxuICAgICAgICBzZXJ2aWNlc1Jvb3QsXG4gICAgICAgIFwic2VydmljZXMvbm90aWZpY2F0aW9uLXNlcnZpY2Uvc3JjL2hhbmRsZXIudHNcIlxuICAgICAgKSxcbiAgICAgIGhhbmRsZXI6IFwiaGFuZGxlVXNlckNyZWF0ZWRcIixcbiAgICAgIHByb2plY3RSb290OiBzZXJ2aWNlc1Jvb3QsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oc2VydmljZXNSb290LCBcInBhY2thZ2UtbG9jay5qc29uXCIpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgTk9USUZJQ0FUSU9OU19UQUJMRTogbm90aWZpY2F0aW9uc1RhYmxlLnRhYmxlTmFtZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgbm90aWZpY2F0aW9uTGFtYmRhLmFkZEV2ZW50U291cmNlKFxuICAgICAgbmV3IGxhbWJkYUV2ZW50U291cmNlcy5TcXNFdmVudFNvdXJjZShub3RpZmljYXRpb25RdWV1ZSwge1xuICAgICAgICBiYXRjaFNpemU6IDUsXG4gICAgICAgIHJlcG9ydEJhdGNoSXRlbUZhaWx1cmVzOiB0cnVlXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBQZXJtaXNvc1xuICAgIHVzZXJzVGFibGUuZ3JhbnRXcml0ZURhdGEodXNlckxhbWJkYSk7XG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyh1c2VyTGFtYmRhKTtcbiAgICBsaXN0aW5nc1RhYmxlLmdyYW50V3JpdGVEYXRhKGxpc3RpbmdMYW1iZGEpO1xuICAgIGV2ZW50QnVzLmdyYW50UHV0RXZlbnRzVG8obGlzdGluZ0xhbWJkYSk7XG4gICAgYm9va2luZ3NUYWJsZS5ncmFudFdyaXRlRGF0YShib29raW5nTGFtYmRhKTtcbiAgICBib29raW5nc1RhYmxlLmdyYW50UmVhZERhdGEoZ2V0Qm9va2luZ0xhbWJkYSk7XG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyhib29raW5nTGFtYmRhKTtcbiAgICByZXZpZXdzVGFibGUuZ3JhbnRXcml0ZURhdGEocmV2aWV3TGFtYmRhKTtcbiAgICByZXZpZXdzVGFibGUuZ3JhbnRSZWFkRGF0YShnZXRSZXZpZXdzTGFtYmRhKTtcbiAgICBldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKHJldmlld0xhbWJkYSk7XG4gICAgbm90aWZpY2F0aW9uc1RhYmxlLmdyYW50V3JpdGVEYXRhKG5vdGlmaWNhdGlvbkxhbWJkYSk7XG4gICAgdXNlcnNUYWJsZS5ncmFudFdyaXRlRGF0YShhdXRoQ29uZmlybUxhbWJkYSk7XG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyhhdXRoQ29uZmlybUxhbWJkYSk7XG5cblxuICAgIGF1dGhDb25maXJtTGFtYmRhLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBjZGsuYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbXCJjb2duaXRvLWlkcDpBZG1pbkdldFVzZXJcIl0sXG4gICAgICAgIHJlc291cmNlczogW3VzZXJQb29sLnVzZXJQb29sQXJuXVxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gQVBJIEdhdGV3YXlcbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsIFwiQWlyYm5iQXBpXCIsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiBcIkFpcmJuYiBTZXJ2aWNlXCIsXG4gICAgfSk7XG5cbiAgICAvLyBDb2duaXRvIEF1dGhvcml6ZXJcbiAgICBjb25zdCBhdXRob3JpemVyID0gbmV3IGFwaWdhdGV3YXkuQ29nbml0b1VzZXJQb29sc0F1dGhvcml6ZXIodGhpcywgXCJBdXRob3JpemVyXCIsIHtcbiAgICAgIGNvZ25pdG9Vc2VyUG9vbHM6IFt1c2VyUG9vbF1cbiAgICB9KTtcblxuICAgIGNvbnN0IHYxID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoXCJ2MVwiKTtcblxuICAgIGNvbnN0IGF1dGggPSB2MS5hZGRSZXNvdXJjZShcImF1dGhcIik7XG5cbiAgICBhdXRoLmFkZFJlc291cmNlKFwicmVnaXN0ZXJcIikuYWRkTWV0aG9kKFxuICAgICAgXCJQT1NUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihhdXRoUmVnaXN0ZXJMYW1iZGEpXG4gICAgKTtcblxuICAgIGF1dGguYWRkUmVzb3VyY2UoXCJjb25maXJtXCIpLmFkZE1ldGhvZChcbiAgICAgIFwiUE9TVFwiLFxuICAgICAgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oYXV0aENvbmZpcm1MYW1iZGEpXG4gICAgKTtcblxuICAgIGF1dGguYWRkUmVzb3VyY2UoXCJsb2dpblwiKS5hZGRNZXRob2QoXG4gICAgICBcIlBPU1RcIixcbiAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGF1dGhMb2dpbkxhbWJkYSlcbiAgICApO1xuXG4gICAgY29uc3QgdXNlcnMgPSB2MS5hZGRSZXNvdXJjZShcInVzZXJzXCIpO1xuXG4gICAgdXNlcnMuYWRkTWV0aG9kKFxuICAgICAgXCJQT1NUXCIsXG4gICAgICBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbih1c2VyTGFtYmRhKSxcbiAgICAgIHtcbiAgICAgICAgYXV0aG9yaXplcixcbiAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgICAgfVxuICAgICk7XG5cbiAgICBjb25zdCBsaXN0aW5ncyA9IHYxLmFkZFJlc291cmNlKFwibGlzdGluZ3NcIik7XG5cbiAgICBsaXN0aW5ncy5hZGRNZXRob2QoXG4gICAgICBcIlBPU1RcIixcbiAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGxpc3RpbmdMYW1iZGEpLFxuICAgICAge1xuICAgICAgICBhdXRob3JpemVyLFxuICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPXG4gICAgICB9XG4gICAgKTtcblxuICAgIGNvbnN0IGJvb2tpbmdzID0gdjEuYWRkUmVzb3VyY2UoXCJib29raW5nc1wiKTtcblxuICAgIGJvb2tpbmdzLmFkZE1ldGhvZChcbiAgICAgIFwiUE9TVFwiLFxuICAgICAgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oYm9va2luZ0xhbWJkYSksXG4gICAgICB7XG4gICAgICAgIGF1dGhvcml6ZXIsXG4gICAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE9cbiAgICAgIH1cbiAgICApO1xuXG4gICAgY29uc3QgYm9va2luZ0J5SWQgPSBib29raW5ncy5hZGRSZXNvdXJjZShcIntib29raW5nSWR9XCIpO1xuXG4gICAgYm9va2luZ0J5SWQuYWRkTWV0aG9kKFxuICAgICAgXCJHRVRcIixcbiAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGdldEJvb2tpbmdMYW1iZGEpLFxuICAgICAge1xuICAgICAgICBhdXRob3JpemVyLFxuICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPXG4gICAgICB9XG4gICAgKTtcblxuICAgIGNvbnN0IHJldmlld3MgPSB2MS5hZGRSZXNvdXJjZShcInJldmlld3NcIik7XG5cbiAgICByZXZpZXdzLmFkZE1ldGhvZChcIlBPU1RcIiwgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24ocmV2aWV3TGFtYmRhKSwge1xuICAgICAgYXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE9cbiAgICB9KTtcblxuICAgIGNvbnN0IHJldmlld3NCeUxpc3RpbmcgPSByZXZpZXdzLmFkZFJlc291cmNlKFwibGlzdGluZ1wiKS5hZGRSZXNvdXJjZShcIntsaXN0aW5nSWR9XCIpO1xuXG4gICAgcmV2aWV3c0J5TGlzdGluZy5hZGRNZXRob2QoXG4gICAgICBcIkdFVFwiLFxuICAgICAgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oZ2V0UmV2aWV3c0xhbWJkYSksXG4gICAgICB7XG4gICAgICAgIGF1dGhvcml6ZXIsXG4gICAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE9cbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiVXNlclBvb2xJZFwiLCB7XG4gICAgICB2YWx1ZTogdXNlclBvb2wudXNlclBvb2xJZFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJVc2VyUG9vbENsaWVudElkXCIsIHtcbiAgICAgIHZhbHVlOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFwaVVybFwiLCB7XG4gICAgICB2YWx1ZTogYXBpLnVybFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJFdmVudEJ1c05hbWVcIiwge1xuICAgICAgdmFsdWU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZVxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJOb3RpZmljYXRpb25RdWV1ZVVybFwiLCB7XG4gICAgICB2YWx1ZTogbm90aWZpY2F0aW9uUXVldWUucXVldWVVcmxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTm90aWZpY2F0aW9uRExRVXJsXCIsIHtcbiAgICAgIHZhbHVlOiBub3RpZmljYXRpb25EbHEucXVldWVVcmxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTm90aWZpY2F0aW9uRExRTmFtZVwiLCB7XG4gICAgICB2YWx1ZTogbm90aWZpY2F0aW9uRGxxLnF1ZXVlTmFtZVxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJOb3RpZmljYXRpb25RdWV1ZU5hbWVcIiwge1xuICAgICAgdmFsdWU6IG5vdGlmaWNhdGlvblF1ZXVlLnF1ZXVlTmFtZVxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJOb3RpZmljYXRpb25zVGFibGVOYW1lXCIsIHtcbiAgICAgIHZhbHVlOiBub3RpZmljYXRpb25zVGFibGUudGFibGVOYW1lXG4gICAgfSk7XG4gIH1cbn0iXX0=
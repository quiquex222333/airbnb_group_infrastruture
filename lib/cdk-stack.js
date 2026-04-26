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
        const notificationQueue = new sqs.Queue(this, "NotificationQueue");
        new events.Rule(this, "UserCreatedRule", {
            eventBus,
            eventPattern: {
                source: ["user.service"],
                detailType: ["user.created"]
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
        // Lambda
        const servicesRoot = path.join(__dirname, "../../airbnb_group_services");
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
        const notificationLambda = new lambdaNodejs.NodejsFunction(this, "NotificationLambda", {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: path.join(servicesRoot, "services/notification-service/src/handler.ts"),
            handler: "handleUserCreated",
            projectRoot: servicesRoot,
            depsLockFilePath: path.join(servicesRoot, "package-lock.json")
        });
        notificationLambda.addEventSource(new lambdaEventSources.SqsEventSource(notificationQueue));
        // Permisos
        usersTable.grantWriteData(userLambda);
        eventBus.grantPutEventsTo(userLambda);
        listingsTable.grantWriteData(listingLambda);
        eventBus.grantPutEventsTo(listingLambda);
        // API Gateway
        const api = new apigateway.RestApi(this, "AirbnbApi", {
            restApiName: "Airbnb Service",
        });
        // Cognito Authorizer
        const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "Authorizer", {
            cognitoUserPools: [userPool]
        });
        const v1 = api.root.addResource("v1");
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
        new cdk.CfnOutput(this, "NotificationQueueName", {
            value: notificationQueue.queueName
        });
    }
}
exports.CdkStack = CdkStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2RrLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY2RrLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZCQUE2QjtBQUM3QixtQ0FBbUM7QUFFbkMsbURBQW1EO0FBQ25ELHFEQUFxRDtBQUNyRCxpREFBaUQ7QUFDakQsaURBQWlEO0FBQ2pELDhEQUE4RDtBQUM5RCx5REFBeUQ7QUFDekQsMkNBQTJDO0FBQzNDLDBEQUEwRDtBQUMxRCwyRUFBMkU7QUFFM0UsTUFBYSxRQUFTLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDckMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLFFBQVEsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGdCQUFnQixDQUFDLENBQUM7UUFFN0QsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLG1CQUFtQixDQUFDLENBQUM7UUFFbkUsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUN2QyxRQUFRO1lBQ1IsWUFBWSxFQUFFO2dCQUNaLE1BQU0sRUFBRSxDQUFDLGNBQWMsQ0FBQztnQkFDeEIsVUFBVSxFQUFFLENBQUMsY0FBYyxDQUFDO2FBQzdCO1lBQ0QsT0FBTyxFQUFFLENBQUMsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLGlCQUFpQixDQUFDLENBQUM7U0FDbkQsQ0FBQyxDQUFDO1FBRUgsb0JBQW9CO1FBQ3BCLE1BQU0sUUFBUSxHQUFHLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFO1lBQ3RELGlCQUFpQixFQUFFLElBQUk7WUFDdkIsYUFBYSxFQUFFLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRTtZQUM5QixVQUFVLEVB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QUMsVUFBVSxDQUFDLENBQUM7UUFFNUMsUUFBUSxDQUFDLFNBQVMsQ0FDaEIsTUFBTSxFQUNOLElBQUksVUFBVSxDQUFDLGlCQUFpQixDQUFDLGFBQWEsQ0FBQyxFQUMvQztZQUNFLFVBQVU7WUFDVixpQkFBaUIsRUFBRSxVQUFVLENBQUMsaUJBQWlCLENBQUMsT0FBTztTQUN4RCxDQUNGLENBQUM7UUFFRixVQUFVO1FBQ1YsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDcEMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxVQUFVO1NBQzNCLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDMUMsS0FBSyxFQUFFLGNBQWMsQ0FBQyxnQkFBZ0I7U0FDdkMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxRQUFRLEVBQUU7WUFDaEMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxHQUFHO1NBQ2YsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDdEMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxZQUFZO1NBQzdCLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7WUFDOUMsS0FBSyxFQUFFLGlCQUFpQixDQUFDLFFBQVE7U0FDbEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUMvQyxLQUFLLEVBQUUsaUJBQWlCLENBQUMsU0FBUztTQUNuQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFwS0QsNEJBb0tDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSBcImF3cy1jZGstbGliL2F3cy1jb2duaXRvXCI7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiXCI7XG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1ldmVudHNcIjtcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYVwiO1xuaW1wb3J0ICogYXMgbGFtYmRhTm9kZWpzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcbmltcG9ydCAqIGFzIHNxcyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNxc1wiO1xuaW1wb3J0ICogYXMgdGFyZ2V0cyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzXCI7XG5pbXBvcnQgKiBhcyBsYW1iZGFFdmVudFNvdXJjZXMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtZXZlbnQtc291cmNlc1wiO1xuXG5leHBvcnQgY2xhc3MgQ2RrU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCBldmVudEJ1cyA9IG5ldyBldmVudHMuRXZlbnRCdXModGhpcywgXCJBaXJibmJFdmVudEJ1c1wiKTtcblxuICAgIGNvbnN0IG5vdGlmaWNhdGlvblF1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCBcIk5vdGlmaWNhdGlvblF1ZXVlXCIpO1xuXG4gICAgbmV3IGV2ZW50cy5SdWxlKHRoaXMsIFwiVXNlckNyZWF0ZWRSdWxlXCIsIHtcbiAgICAgIGV2ZW50QnVzLFxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XG4gICAgICAgIHNvdXJjZTogW1widXNlci5zZXJ2aWNlXCJdLFxuICAgICAgICBkZXRhaWxUeXBlOiBbXCJ1c2VyLmNyZWF0ZWRcIl1cbiAgICAgIH0sXG4gICAgICB0YXJnZXRzOiBbbmV3IHRhcmdldHMuU3FzUXVldWUobm90aWZpY2F0aW9uUXVldWUpXVxuICAgIH0pO1xuXG4gICAgLy8gQ29nbml0byBVc2VyIFBvb2xcbiAgICBjb25zdCB1c2VyUG9vbCA9IG5ldyBjb2duaXRvLlVzZXJQb29sKHRoaXMsIFwiVXNlclBvb2xcIiwge1xuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXG4gICAgICBzaWduSW5BbGlhc2VzOiB7IGVtYWlsOiB0cnVlIH0sXG4gICAgICBhdXRvVmVyaWZ5OiB7IGVtYWlsOiB0cnVlIH0sXG4gICAgICBwYXNzd29yZFBvbGljeToge1xuICAgICAgICBtaW5MZW5ndGg6IDgsXG4gICAgICAgIHJlcXVpcmVMb3dlcmNhc2U6IHRydWUsXG4gICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXG4gICAgICAgIHJlcXVpcmVEaWdpdHM6IHRydWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIENvZ25pdG8gQXBwIENsaWVudFxuICAgIGNvbnN0IHVzZXJQb29sQ2xpZW50ID0gbmV3IGNvZ25pdG8uVXNlclBvb2xDbGllbnQodGhpcywgXCJVc2VyUG9vbENsaWVudFwiLCB7XG4gICAgICB1c2VyUG9vbCxcbiAgICAgIGF1dGhGbG93czoge1xuICAgICAgICB1c2VyUGFzc3dvcmQ6IHRydWUsXG4gICAgICAgIHVzZXJTcnA6IHRydWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIER5bmFtb0RCIFRhYmxlXG4gICAgY29uc3QgdXNlcnNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCBcIlVzZXJzVGFibGVcIiwge1xuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwiZW1haWxcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZIC8vIHNvbG8gcGFyYSBkZW1vXG4gICAgfSk7XG5cbiAgICBjb25zdCBsaXN0aW5nc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsIFwiTGlzdGluZ3NUYWJsZVwiLCB7XG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJsaXN0aW5nSWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1RcbiAgICB9KTtcblxuICAgIC8vIExhbWJkYVxuICAgIGNvbnN0IHNlcnZpY2VzUm9vdCA9IHBhdGguam9pbihfX2Rpcm5hbWUsIFwiLi4vLi4vYWlyYm5iX2dyb3VwX3NlcnZpY2VzXCIpO1xuXG4gICAgY29uc3QgdXNlckxhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJVc2VyTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL3VzZXItc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJjcmVhdGVVc2VyXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFVTRVJTX1RBQkxFOiB1c2Vyc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgbGlzdGluZ0xhbWJkYSA9IG5ldyBsYW1iZGFOb2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJMaXN0aW5nTGFtYmRhXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgc2VydmljZXNSb290LFxuICAgICAgICBcInNlcnZpY2VzL2xpc3Rpbmctc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJjcmVhdGVMaXN0aW5nXCIsXG4gICAgICBwcm9qZWN0Um9vdDogc2VydmljZXNSb290LFxuICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHNlcnZpY2VzUm9vdCwgXCJwYWNrYWdlLWxvY2suanNvblwiKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIExJU1RJTkdTX1RBQkxFOiBsaXN0aW5nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCBcIk5vdGlmaWNhdGlvbkxhbWJkYVwiLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oXG4gICAgICAgIHNlcnZpY2VzUm9vdCxcbiAgICAgICAgXCJzZXJ2aWNlcy9ub3RpZmljYXRpb24tc2VydmljZS9zcmMvaGFuZGxlci50c1wiXG4gICAgICApLFxuICAgICAgaGFuZGxlcjogXCJoYW5kbGVVc2VyQ3JlYXRlZFwiLFxuICAgICAgcHJvamVjdFJvb3Q6IHNlcnZpY2VzUm9vdCxcbiAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihzZXJ2aWNlc1Jvb3QsIFwicGFja2FnZS1sb2NrLmpzb25cIilcbiAgICB9KTtcblxuICAgIG5vdGlmaWNhdGlvbkxhbWJkYS5hZGRFdmVudFNvdXJjZShcbiAgICAgIG5ldyBsYW1iZGFFdmVudFNvdXJjZXMuU3FzRXZlbnRTb3VyY2Uobm90aWZpY2F0aW9uUXVldWUpXG4gICAgKTtcblxuICAgIC8vIFBlcm1pc29zXG4gICAgdXNlcnNUYWJsZS5ncmFudFdyaXRlRGF0YSh1c2VyTGFtYmRhKTtcbiAgICBldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKHVzZXJMYW1iZGEpO1xuICAgIGxpc3RpbmdzVGFibGUuZ3JhbnRXcml0ZURhdGEobGlzdGluZ0xhbWJkYSk7XG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyhsaXN0aW5nTGFtYmRhKTtcblxuICAgIC8vIEFQSSBHYXRld2F5XG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCBcIkFpcmJuYkFwaVwiLCB7XG4gICAgICByZXN0QXBpTmFtZTogXCJBaXJibmIgU2VydmljZVwiLFxuICAgIH0pO1xuXG4gICAgLy8gQ29nbml0byBBdXRob3JpemVyXG4gICAgY29uc3QgYXV0aG9yaXplciA9IG5ldyBhcGlnYXRld2F5LkNvZ25pdG9Vc2VyUG9vbHNBdXRob3JpemVyKHRoaXMsIFwiQXV0aG9yaXplclwiLCB7XG4gICAgICBjb2duaXRvVXNlclBvb2xzOiBbdXNlclBvb2xdXG4gICAgfSk7XG5cbiAgICBjb25zdCB2MSA9IGFwaS5yb290LmFkZFJlc291cmNlKFwidjFcIik7XG5cbiAgICBjb25zdCB1c2VycyA9IHYxLmFkZFJlc291cmNlKFwidXNlcnNcIik7XG5cbiAgICB1c2Vycy5hZGRNZXRob2QoXG4gICAgICBcIlBPU1RcIixcbiAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHVzZXJMYW1iZGEpLFxuICAgICAge1xuICAgICAgICBhdXRob3JpemVyLFxuICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPXG4gICAgICB9XG4gICAgKTtcblxuICAgIGNvbnN0IGxpc3RpbmdzID0gdjEuYWRkUmVzb3VyY2UoXCJsaXN0aW5nc1wiKTtcblxuICAgIGxpc3RpbmdzLmFkZE1ldGhvZChcbiAgICAgIFwiUE9TVFwiLFxuICAgICAgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24obGlzdGluZ0xhbWJkYSksXG4gICAgICB7XG4gICAgICAgIGF1dGhvcml6ZXIsXG4gICAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE9cbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiVXNlclBvb2xJZFwiLCB7XG4gICAgICB2YWx1ZTogdXNlclBvb2wudXNlclBvb2xJZFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJVc2VyUG9vbENsaWVudElkXCIsIHtcbiAgICAgIHZhbHVlOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFwaVVybFwiLCB7XG4gICAgICB2YWx1ZTogYXBpLnVybFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJFdmVudEJ1c05hbWVcIiwge1xuICAgICAgdmFsdWU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZVxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJOb3RpZmljYXRpb25RdWV1ZVVybFwiLCB7XG4gICAgICB2YWx1ZTogbm90aWZpY2F0aW9uUXVldWUucXVldWVVcmxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTm90aWZpY2F0aW9uUXVldWVOYW1lXCIsIHtcbiAgICAgIHZhbHVlOiBub3RpZmljYXRpb25RdWV1ZS5xdWV1ZU5hbWVcbiAgICB9KTtcbiAgfVxufSJdfQ==
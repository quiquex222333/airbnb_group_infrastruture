import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
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

    // Lambda
    const servicesRoot = path.join(__dirname, "../../airbnb_group_services");

    const userLambda = new lambdaNodejs.NodejsFunction(this, "UserLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(
        servicesRoot,
        "services/user-service/src/handler.ts"
      ),
      handler: "createUser",
      projectRoot: servicesRoot,
      depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
      environment: {
        USERS_TABLE: usersTable.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName
      }
    });

    const notificationLambda = new lambdaNodejs.NodejsFunction(this, "NotificationLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(
        servicesRoot,
        "services/notification-service/src/handler.ts"
      ),
      handler: "handleUserCreated",
      projectRoot: servicesRoot,
      depsLockFilePath: path.join(servicesRoot, "package-lock.json")
    });

    notificationLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(notificationQueue)
    );

    // Permisos
    usersTable.grantWriteData(userLambda);
    eventBus.grantPutEventsTo(userLambda);

    // API Gateway
    const api = new apigateway.RestApi(this, "AirbnbApi", {
      restApiName: "Airbnb Service",
    });

    // Cognito Authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "Authorizer", {
      cognitoUserPools: [userPool]
    });

    const users = api.root.addResource("v1").addResource("users");

    users.addMethod(
      "POST",
      new apigateway.LambdaIntegration(userLambda),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO
      }
    );

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
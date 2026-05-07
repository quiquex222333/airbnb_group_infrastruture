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
      entry: path.join(
        servicesRoot,
        "services/auth-service/src/handler.ts"
      ),
      handler: "register",
      projectRoot: servicesRoot,
      depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
      environment: {
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId
      }
    });

    const authConfirmLambda = new lambdaNodejs.NodejsFunction(this, "AuthConfirmLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(
        servicesRoot,
        "services/auth-service/src/handler.ts"
      ),
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
      entry: path.join(
        servicesRoot,
        "services/auth-service/src/handler.ts"
      ),
      handler: "login",
      projectRoot: servicesRoot,
      depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
      environment: {
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        USER_POOL_ID: userPool.userPoolId,
        USERS_TABLE: usersTable.tableName
      }
    });

    const authRefreshLambda = new lambdaNodejs.NodejsFunction(this, "AuthRefreshLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(
        servicesRoot,
        "services/auth-service/src/handler.ts"
      ),
      handler: "refresh",
      projectRoot: servicesRoot,
      depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
      environment: {
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        USERS_TABLE: usersTable.tableName
      }
    });

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

    const listingLambda = new lambdaNodejs.NodejsFunction(this, "ListingLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(
        servicesRoot,
        "services/listing-service/src/handler.ts"
      ),
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
      entry: path.join(
        servicesRoot,
        "services/booking-service/src/handler.ts"
      ),
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
      entry: path.join(
        servicesRoot,
        "services/booking-service/src/handler.ts"
      ),
      handler: "getBookingById",
      projectRoot: servicesRoot,
      depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
      environment: {
        BOOKINGS_TABLE: bookingsTable.tableName
      }
    });

    const reviewLambda = new lambdaNodejs.NodejsFunction(this, "ReviewLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(
        servicesRoot,
        "services/review-service/src/handler.ts"
      ),
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
      entry: path.join(
        servicesRoot,
        "services/review-service/src/handler.ts"
      ),
      handler: "getReviewsByListing",
      projectRoot: servicesRoot,
      depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
      environment: {
        REVIEWS_TABLE: reviewsTable.tableName
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
      depsLockFilePath: path.join(servicesRoot, "package-lock.json"),
      environment: {
        NOTIFICATIONS_TABLE: notificationsTable.tableName
      }
    });

    notificationLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(notificationQueue, {
        batchSize: 5,
        reportBatchItemFailures: true
      })
    );

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


    authConfirmLambda.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["cognito-idp:AdminGetUser"],
        resources: [userPool.userPoolArn]
      })
    );

    // API Gateway
    const api = new apigateway.RestApi(this, "AirbnbApi", {
      restApiName: "Airbnb Service",
      defaultCorsPreflightOptions: {
        allowOrigins: ["http://localhost:5173"],
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

    auth.addResource("register").addMethod(
      "POST",
      new apigateway.LambdaIntegration(authRegisterLambda)
    );

    auth.addResource("confirm").addMethod(
      "POST",
      new apigateway.LambdaIntegration(authConfirmLambda)
    );

    auth.addResource("login").addMethod(
      "POST",
      new apigateway.LambdaIntegration(authLoginLambda)
    );

    auth.addResource("refresh").addMethod(
      "POST",
      new apigateway.LambdaIntegration(authRefreshLambda)
    );

    const users = v1.addResource("users");

    users.addMethod(
      "POST",
      new apigateway.LambdaIntegration(userLambda),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO
      }
    );

    const listings = v1.addResource("listings");

    listings.addMethod(
      "POST",
      new apigateway.LambdaIntegration(listingLambda),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO
      }
    );

    const bookings = v1.addResource("bookings");

    bookings.addMethod(
      "POST",
      new apigateway.LambdaIntegration(bookingLambda),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO
      }
    );

    const bookingById = bookings.addResource("{bookingId}");

    bookingById.addMethod(
      "GET",
      new apigateway.LambdaIntegration(getBookingLambda),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO
      }
    );

    const reviews = v1.addResource("reviews");

    reviews.addMethod("POST", new apigateway.LambdaIntegration(reviewLambda), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    const reviewsByListing = reviews.addResource("listing").addResource("{listingId}");

    reviewsByListing.addMethod(
      "GET",
      new apigateway.LambdaIntegration(getReviewsLambda),
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
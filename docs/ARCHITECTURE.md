# Arquitectura del Stack CDK

Este documento describe la infraestructura definida en `lib/cdk-stack.ts`.

## 1. Resumen

El stack levanta una API protegida con Cognito, persistencia en DynamoDB y un flujo asincrono EventBridge -> SQS -> Lambda para notificaciones.

## 2. Recursos principales

### Seguridad e identidad

- `UserPool` (Cognito User Pool)
- `UserPoolClient` (Cognito App Client)
- `Authorizer` (API Gateway Cognito authorizer)

### API

- `AirbnbApi` (API Gateway REST)
- Recurso raiz versionado: `/v1`

### Persistencia

- `UsersTable` (PK: `email`)
- `ListingsTable` (PK: `listingId`)
- `BookingsTable` (PK: `bookingId`)
- `ReviewsTable` (PK: `reviewId`)
- GSI en `ReviewsTable`: `listingId-index` (PK: `listingId`)

### Event driven

- `AirbnbEventBus` (EventBridge custom bus)
- `NotificationQueue` (SQS)
- `UserCreatedRule` (EventBridge Rule)
- `NotificationLambda` con `SqsEventSource(NotificationQueue)`

## 3. Mapeo de endpoints y handlers

Los handlers no viven en este repo; se empaquetan desde `../airbnb_group_services`.

- `POST /v1/users` -> `services/user-service/src/handler.ts#createUser`
- `POST /v1/listings` -> `services/listing-service/src/handler.ts#createListing`
- `POST /v1/bookings` -> `services/booking-service/src/handler.ts#createBooking`
- `GET /v1/bookings/{bookingId}` -> `services/booking-service/src/handler.ts#getBookingById`
- `POST /v1/reviews` -> `services/review-service/src/handler.ts#createReview`
- `GET /v1/reviews/listing/{listingId}` -> `services/review-service/src/handler.ts#getReviewsByListing`

Todas las rutas usan `AuthorizationType.COGNITO`.

## 4. Variables de entorno por Lambda

- `UserLambda`
  - `USERS_TABLE`
  - `EVENT_BUS_NAME`
- `ListingLambda`
  - `LISTINGS_TABLE`
  - `EVENT_BUS_NAME`
- `BookingLambda`
  - `BOOKINGS_TABLE`
  - `EVENT_BUS_NAME`
- `GetBookingLambda`
  - `BOOKINGS_TABLE`
- `ReviewLambda`
  - `REVIEWS_TABLE`
  - `EVENT_BUS_NAME`
- `GetReviewsLambda`
  - `REVIEWS_TABLE`
- `NotificationLambda`
  - sin variables obligatorias hoy

## 5. Permisos aplicados por CDK

- `usersTable.grantWriteData(userLambda)`
- `listingsTable.grantWriteData(listingLambda)`
- `bookingsTable.grantWriteData(bookingLambda)`
- `bookingsTable.grantReadData(getBookingLambda)`
- `reviewsTable.grantWriteData(reviewLambda)`
- `reviewsTable.grantReadData(getReviewsLambda)`
- `eventBus.grantPutEventsTo(...)` para Lambdas productoras de eventos

## 6. Flujo de eventos

1. `UserCreatedRule` escucha eventos en `AirbnbEventBus` con:
   - `source = user.service`
   - `detailType = user.created`
2. Cuando hay match, el evento se envia a `NotificationQueue`.
3. `NotificationLambda` consume mensajes de `NotificationQueue`.

Observacion importante:

- Actualmente `user-service` no publica `user.created`, por lo que este flujo no se activa a menos que otro productor emita ese evento.

## 7. Outputs del stack

- `ApiUrl`
- `UserPoolId`
- `UserPoolClientId`
- `EventBusName`
- `NotificationQueueUrl`
- `NotificationQueueName`

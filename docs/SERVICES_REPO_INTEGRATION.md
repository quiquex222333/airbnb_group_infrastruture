# Integracion con `airbnb_group_services`

Este repo depende directamente del repo hermano `airbnb_group_services` para construir los artefactos Lambda.

## 1. Estructura esperada de carpetas

```txt
arq_nube_microservicios/
|-- airbnb_group_infrastruture
`-- airbnb_group_services
```

Si cambias esta estructura, debes actualizar `servicesRoot` en `lib/cdk-stack.ts`.

## 2. Como se resuelve la dependencia

En `lib/cdk-stack.ts` se define:

- `servicesRoot = path.join(__dirname, "../../airbnb_group_services")`

Cada `NodejsFunction` usa:

- `entry` apuntando a `services/*/src/handler.ts`
- `projectRoot: servicesRoot`
- `depsLockFilePath: ../airbnb_group_services/package-lock.json`

Esto significa que `cdk synth/deploy` necesita el repo de servicios disponible localmente.

## 3. Setup recomendado

1. Instalar dependencias en servicios:

```bash
cd ../airbnb_group_services
npm install
```

2. Volver al repo de infraestructura e instalar:

```bash
cd ../airbnb_group_infrastruture
npm install
npm run build
```

3. Desplegar:

```bash
npx cdk bootstrap   # primera vez por cuenta/region
npx cdk synth
npx cdk deploy
```

## 4. Validaciones rapidas antes de deploy

Ejecuta desde `airbnb_group_infrastruture`:

```bash
test -f ../airbnb_group_services/package-lock.json && echo "lockfile ok"
test -f ../airbnb_group_services/services/user-service/src/handler.ts && echo "user handler ok"
test -f ../airbnb_group_services/services/listing-service/src/handler.ts && echo "listing handler ok"
test -f ../airbnb_group_services/services/booking-service/src/handler.ts && echo "booking handler ok"
test -f ../airbnb_group_services/services/review-service/src/handler.ts && echo "review handler ok"
test -f ../airbnb_group_services/services/notification-service/src/handler.ts && echo "notification handler ok"
```

## 5. Ciclo de cambios entre repos

Cuando cambies codigo de un handler en `airbnb_group_services`:

1. Guarda cambios y asegura que compile/pruebe en el repo de servicios.
2. Regresa al repo de infraestructura.
3. Ejecuta `npx cdk diff` para validar impacto.
4. Ejecuta `npx cdk deploy` para actualizar Lambdas.

## 6. Errores comunes

### `Cannot find entry file .../services/.../handler.ts`

- Causa: ruta incorrecta o repos no estan al mismo nivel.
- Solucion: reubicar carpetas o ajustar `servicesRoot`.

### `Cannot find module` durante bundling

- Causa: dependencias no instaladas en `airbnb_group_services`.
- Solucion: correr `npm install` en el repo de servicios.

### Error con `depsLockFilePath`

- Causa: falta `package-lock.json` en servicios.
- Solucion: generar lockfile con `npm install` y volver a desplegar.

## 7. Consistencia esperada con el repo de servicios

La documentacion de servicios en `../airbnb_group_services/docs/INFRASTRUCTURE_INTEGRATION.md` debe mantenerse alineada con este documento.

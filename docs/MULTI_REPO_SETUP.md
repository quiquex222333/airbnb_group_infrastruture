# Guia de ejecucion multi-repositorio

El sistema Airbnb esta dividido en cuatro repositorios Git. La infraestructura empaqueta el codigo de servicios y compila el frontend durante el despliegue, por lo que los tres repositorios de aplicacion deben conservar los nombres y la estructura indicados.

## Repositorios

| Componente | Repositorio | Responsabilidad |
| --- | --- | --- |
| Infraestructura | [airbnb_group_infrastruture](https://github.com/quiquex222333/airbnb_group_infrastruture) | AWS CDK, API Gateway, Cognito, DynamoDB, Lambda, EventBridge, SQS, S3 y CloudFront. |
| Servicios | [airbnb_group_back](https://github.com/quiquex222333/airbnb_group_back) | Handlers Lambda, contratos y servicio de inferencia ML. La carpeta local debe llamarse `airbnb_group_services`. |
| Frontend | [airbnb_group_front](https://github.com/quiquex222333/airbnb_group_front) | React/Vite, autenticacion, flujos Airbnb y pantalla de segmentacion ML. |
| MLOps | [protecto_modulo_15](https://github.com/quiquex222333/protecto_modulo_15) | Datos, notebook, entrenamiento y artefacto fuente del modelo K-Means. |

> `airbnb_group_infrastruture` conserva el error ortografico del nombre original. No renombres esa carpeta sin actualizar las rutas y scripts del proyecto.

## Estructura local requerida

```text
workspace/
├── airbnb_group_infrastruture/
├── airbnb_group_services/       # clone de airbnb_group_back
├── airbnb_group_front/
└── protecto_modulo_15/          # puede vivir en otra ruta; no se usa en runtime
```

Clonacion desde una carpeta vacia:

```bash
git clone https://github.com/quiquex222333/airbnb_group_infrastruture.git
git clone https://github.com/quiquex222333/airbnb_group_back.git airbnb_group_services
git clone https://github.com/quiquex222333/airbnb_group_front.git
git clone https://github.com/quiquex222333/protecto_modulo_15.git
```

## Prerrequisitos

- Node.js 20 o superior y npm 10 o superior.
- Python 3.11 para reentrenar o probar el modelo MLOps.
- AWS CLI con credenciales configuradas para despliegues.
- Permisos para CloudFormation, IAM, S3, CloudFront, Lambda, API Gateway, Cognito, DynamoDB, EventBridge y SQS.

Comprueba la cuenta y region activas antes de desplegar:

```bash
aws sts get-caller-identity
aws configure get region
```

## Instalacion completa

```bash
cd airbnb_group_services
npm install
npm run services:build

cd ../airbnb_group_front
npm install
npm run build

cd ../airbnb_group_infrastruture
npm install
cp template.env .env
npm run build
```

En `.env` de infraestructura configura el origen permitido por CORS:

```env
FRONTEND_URL=http://localhost:5173
```

## Ejecutar el frontend localmente

El backend esta compuesto por Lambdas, por lo que el flujo local normal usa una API ya desplegada en AWS.

```bash
cd airbnb_group_front
cp template.env .env
```

Configura `.env`:

```env
VITE_API_URL=/v1
VITE_API_TARGET=https://API_ID.execute-api.REGION.amazonaws.com/prod
```

Luego inicia Vite:

```bash
npm run dev
```

La aplicacion queda disponible en `http://localhost:5173`; Vite envia `/v1/*` al valor de `VITE_API_TARGET`.

## Desplegar todo en AWS

La cuenta y region deben inicializarse una vez con CDK. Usa el binario local para mantener la version del proyecto:

```bash
cd airbnb_group_infrastruture
./node_modules/.bin/cdk bootstrap aws://ACCOUNT_ID/REGION
./node_modules/.bin/cdk diff
./node_modules/.bin/cdk deploy
```

El deploy realiza automaticamente estas tareas:

1. Compila `../airbnb_group_front` con `VITE_API_URL=/v1`.
2. Empaqueta los handlers desde `../airbnb_group_services`.
3. Despliega backend, frontend e infraestructura con CloudFormation.

Para omitir temporalmente el build del frontend durante `synth` o `diff`:

```bash
SKIP_FRONTEND_BUILD=1 ./node_modules/.bin/cdk synth
```

Para eliminar los recursos del stack:

```bash
./node_modules/.bin/cdk destroy
```

El stack `CDKToolkit` del bootstrap es independiente y no se elimina con este comando.

## Modelo ML

El repositorio MLOps contiene el entrenamiento y el artefacto fuente:

```bash
cd protecto_modulo_15
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python src/train.py --input data/processed/listings_features.csv --k 6
```

El artefacto desplegable es `models/kmeans_artifact.json`. La Lambda usa una copia versionada en:

```text
airbnb_group_services/services/ml-service/src/kmeans_artifact.json
```

Cuando se reentrene el modelo, copia el nuevo artefacto a esa ubicacion, incrementa su campo `version`, valida los builds de servicios y vuelve a ejecutar `cdk deploy`.

La UI de anfitrion consume el endpoint autenticado `POST /v1/ml/predict` desde la ruta `/host/market-segmentation`.

## Verificacion por repositorio

```bash
cd airbnb_group_services && npm run services:build && npm test
cd ../airbnb_group_front && npm run build && npm run lint
cd ../airbnb_group_infrastruture && npm run build
FRONTEND_URL=http://localhost:5173 SKIP_FRONTEND_BUILD=1 ./node_modules/.bin/cdk synth
```

## Problemas comunes

- **No se encuentra `airbnb_group_services` o `airbnb_group_front`:** revisa que sean carpetas hermanas de infraestructura y tengan exactamente esos nombres.
- **Falla el bundling de Lambda:** ejecuta `npm install` en servicios antes de sintetizar o desplegar.
- **No existe el bucket `cdk-hnb659fds-assets-*`:** repara o ejecuta el bootstrap para la misma combinacion cuenta/region.
- **CORS en desarrollo:** usa `FRONTEND_URL=http://localhost:5173` al desplegar la API.
- **La UI no refleja cambios:** vuelve a ejecutar `cdk deploy` y realiza una recarga forzada para descartar cache del navegador/CloudFront.

#!/usr/bin/env node
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import { CdkStack } from '../lib/cdk-stack';

function isModuleNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND';
}

let dotenvLoaded = false;

try {
  // Load .env variables when dotenv is installed.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
  dotenvLoaded = true;
} catch (error: unknown) {
  if (!isModuleNotFoundError(error)) {
    throw error;
  }
}

function buildFrontendForDeployment(): void {
  if (process.env.SKIP_FRONTEND_BUILD === '1') {
    console.log('[cdk] SKIP_FRONTEND_BUILD=1, se omite la compilacion del frontend.');
    return;
  }

  const frontendRoot = path.resolve(__dirname, '../../airbnb_group_front');
  const frontendPackageJsonPath = path.join(frontendRoot, 'package.json');
  const apiBaseUrl = process.env.FRONTEND_BUILD_API_URL ?? '/v1';

  if (!fs.existsSync(frontendPackageJsonPath)) {
    throw new Error(
      `No se encontro package.json del frontend en ${frontendPackageJsonPath}. ` +
      'Asegura que airbnb_group_front este al mismo nivel que airbnb_group_infrastruture.'
    );
  }

  console.log(`[cdk] Compilando frontend en ${frontendRoot} con VITE_API_URL=${apiBaseUrl}`);
  execSync('npm run build', {
    cwd: frontendRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_API_URL: apiBaseUrl
    }
  });
}

if (!process.env.FRONTEND_URL) {
  const nextStep = dotenvLoaded
    ? 'Define FRONTEND_URL en tu archivo .env (puedes copiar template.env a .env).'
    : 'Ejecuta npm install en este repo para instalar dotenv y luego define FRONTEND_URL en .env.';

  throw new Error(`FRONTEND_URL no esta definida. ${nextStep}`);
}

buildFrontendForDeployment();

const app = new cdk.App();
new CdkStack(app, 'CdkStack', {
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});

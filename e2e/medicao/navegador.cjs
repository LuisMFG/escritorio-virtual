// Dentro do contêiner: abre o Chromium com câmera e microfone falsos e espera o teste conectar
// pela porta 3000.
/* eslint-disable @typescript-eslint/no-require-imports -- roda com o Node do contêiner */
/* global require, console */
const { chromium } = require('playwright');

chromium
  .launchServer({
    host: '0.0.0.0',
    port: 3000,
    wsPath: '/',
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
    ],
  })
  .then(() => console.log('navegador pronto'));

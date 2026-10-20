/**
 * `npm start`: modo produção em qualquer sistema. O `NODE_ENV=production comando` do shell não
 * existe no Windows (PowerShell/cmd), então o ambiente é definido aqui antes de carregar o
 * servidor (a configuração lê o `NODE_ENV` na hora do import).
 */
process.env.NODE_ENV ||= 'production';
await import('./index.js');

export {};

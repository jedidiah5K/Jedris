// pm2 process file for dcism.org "Custom Application Hosting".
// Set PORT to the port shown in the subdomain's settings, e.g.:
//   PORT=20279 npx pm2 start ecosystem.config.cjs && npx pm2 save
module.exports = {
  apps: [{
    name: 'jedris',
    script: 'server/index.js',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      PORT: process.env.PORT || 51920,
      HOST: process.env.HOST || '0.0.0.0',
    },
    max_restarts: 50,
    restart_delay: 2000,
  }],
};

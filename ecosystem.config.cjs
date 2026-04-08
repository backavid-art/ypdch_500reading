module.exports = {
  apps: [
    {
      name: 'bible-hall',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        ADMIN_PASSWORD: 'change-this-password',
        DATA_DIR: './data'
      }
    }
  ]
};

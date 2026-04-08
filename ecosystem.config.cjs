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
        DATABASE_URL: 'postgresql://postgres:password@db.xxx.supabase.co:5432/postgres',
        APP_TZ: 'Asia/Seoul'
      }
    }
  ]
};

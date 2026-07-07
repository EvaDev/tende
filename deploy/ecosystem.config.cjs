const path = require('path');

const root = path.join(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'imali-server',
      cwd: path.join(root, 'server'),
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};

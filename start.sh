#! /bin/bash

docker_available=false
if command -v docker &>/dev/null && curl -s --unix-socket /var/run/docker.sock http/_ping 2>&1 >/dev/null; then
  docker_available=true
fi

cp -n apps.default.env apps.env

npm install

if $docker_available; then
  sed -i -E 's/apiUrl:(.*):3000/apiUrl:\1:4000/' ./config.ts
else
  sed -i -E 's/apiUrl:(.*):4000/apiUrl:\1:3000/' ./config.ts
fi

cp ./config.ts ./api/
cp ./config.ts ./web/config.mts

cd web
npm run dev &
cd -

if $docker_available; then
  docker compose pull
  docker compose down
  docker compose up
else
  npm --prefix ./api start
fi

wait

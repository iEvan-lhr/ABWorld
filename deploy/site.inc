root /usr/share/nginx/html;
index index.html;
client_max_body_size 64k;
location = /api/health { proxy_pass http://abworld_api; }
location /api/ {
  if ($scheme = http) { return 308 https://$host$request_uri; }
  proxy_http_version 1.1;
  proxy_set_header Host $http_host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-World-Front "public";
  proxy_set_header X-World-Front-Local "0";
  proxy_set_header Connection "";
  proxy_cookie_flags abworld_sid secure httponly samesite=strict;
  proxy_read_timeout 8h;
  proxy_pass http://abworld_api;
}
location / { try_files $uri $uri/ =404; }
location = /index.html { add_header Cache-Control "no-cache"; }

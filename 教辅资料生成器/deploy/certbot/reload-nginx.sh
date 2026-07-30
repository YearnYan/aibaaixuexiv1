#!/bin/sh
# 证书续期成功后，让 Nginx 立即加载新证书。
exec systemctl reload nginx

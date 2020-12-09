#!/usr/bin/env sh

sed -i '' "s/\"version\": \"1.0.0\"/\"version\": \"1.0.$BUILD_NUMBER\"/g" package.json

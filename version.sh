#!/usr/bin/env sh

sed -i '' "s/\(\"version\": \"[0-9]*\.[0-9]*\.\)[0-9]*\(.*\)/\1$GITHUB_RUN_NUMBER\2/g" package.json

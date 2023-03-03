#!/bin/bash

set -euo pipefail

topDir=$(readlink -f "$(dirname "$0")")

cd "$topDir/frontend"
npm run build

cd "$topDir/backend"
npm run main

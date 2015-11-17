#!/bin/bash
set -e

echo 'building with node-gyp'
# build configuration is in the binding.gyp file
node-gyp rebuild


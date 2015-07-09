#!/bin/bash

SCRIPT=`pwd`/$0
FILENAME=`basename $SCRIPT`
ROOT=`dirname $SCRIPT`
CURRENT_DIR=`pwd`

# These all need to be set
export AWS_REGION='us-east-1'
export AWS_BUCKET_NAME='aws-bucket-name'
export AWS_ACCESS_KEY_ID='aws-access-key'
export AWS_SECRET_ACCESS_KEY='aws-secret-key'

cd $ROOT/erizoController
node erizoController.js &

cd $CURRENT_DIR

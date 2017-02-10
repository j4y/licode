#!/bin/bash

set -e

SCRIPT=`pwd`/$0
FILENAME=`basename $SCRIPT`
PATHNAME=`dirname $SCRIPT`
ROOT=$PATHNAME/..
BUILD_DIR=$ROOT/build
CURRENT_DIR=`pwd`

LIB_DIR=$BUILD_DIR/libdeps
PREFIX_DIR=$LIB_DIR/build/

parse_arguments(){
  while [ "$1" != "" ]; do
    case $1 in
      "--enable-gpl")
        ENABLE_GPL=true
        ;;
      "--cleanup")
        CLEANUP=true
        ;;
    esac
    shift
  done
}

check_proxy(){
  if [ -z "$http_proxy" ]; then
    echo "No http proxy set, doing nothing"
  else
    echo "http proxy configured, configuring npm"
    npm config set proxy $http_proxy
  fi  

  if [ -z "$https_proxy" ]; then
    echo "No https proxy set, doing nothing"
  else
    echo "https proxy configured, configuring npm"
    npm config set https-proxy $https_proxy
  fi  
}

install_apt_deps(){
  # install epel which enables the repo that contains some of
  # the packages that we need
  sudo yum -y install epel-release
  # now that yum knows about epel it can install the rest of the packages
  sudo yum -y install patch git make gcc bzip2-devel x264-devel libav-devel libnice-devel libsrtp-devel libvpx-devel opus-devel openssl-devel cmake pkgconfig glib2-devel boost-devel boost-regex boost-thread boost-system log4cxx-devel rabbitmq-server curl boost-test tar xz libffi-devel yasm java-1.7.0-openjdk
}

install_node(){
    # we used to use epel packages but they upgraded to a version of
    # nodejs that's incompatible with licode so now we get it from the
    # upstream source
    wget http://nodejs.org/dist/v0.10.36/node-v0.10.36-linux-x64.tar.gz
    sudo tar --strip-components 1 -xzf node-v* -C /usr/local
    sudo npm install -g node-gyp@0.10.6
}

parse_arguments $*

mkdir -p $PREFIX_DIR

install_apt_deps
install_node

check_proxy

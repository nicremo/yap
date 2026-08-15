#!/bin/sh
set -eu

mkdir -p build/native
swiftc swift/YapHelper.swift -o build/native/yap-helper

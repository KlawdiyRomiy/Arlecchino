//go:build darwin || linux || freebsd || openbsd || netbsd || dragonfly

package mcp

import "syscall"

const openNoFollowFlag = syscall.O_NOFOLLOW

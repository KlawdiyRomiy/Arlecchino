package brain

import (
	"testing"
)

func TestImportChainResolver_PHP(t *testing.T) {
	r := NewImportChainResolver()

	tests := []struct {
		name      string
		content   string
		shortName string
		want      string
	}{
		{
			name: "simple use",
			content: `<?php
namespace App\Http\Controllers;

use Illuminate\Support\Facades\Route;
use App\Models\User;

class TestController {}`,
			shortName: "Route",
			want:      "Illuminate\\Support\\Facades\\Route",
		},
		{
			name: "use with alias",
			content: `<?php
use App\Models\User as UserModel;`,
			shortName: "UserModel",
			want:      "App\\Models\\User",
		},
		{
			name: "group use",
			content: `<?php
use App\Models\{User, Post, Comment};`,
			shortName: "Post",
			want:      "App\\Models\\Post",
		},
		{
			name:      "not imported",
			content:   `<?php\nuse App\Models\User;`,
			shortName: "NotImported",
			want:      "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := r.ResolveClassName("test.php", []byte(tt.content), tt.shortName, "php")
			if got != tt.want {
				t.Errorf("ResolveClassName() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestImportChainResolver_TypeScript(t *testing.T) {
	r := NewImportChainResolver()

	tests := []struct {
		name      string
		content   string
		shortName string
		want      string
	}{
		{
			name:      "named import",
			content:   `import { useState, useEffect } from 'react';`,
			shortName: "useState",
			want:      "react",
		},
		{
			name:      "default import",
			content:   `import React from 'react';`,
			shortName: "React",
			want:      "react",
		},
		{
			name:      "aliased import",
			content:   `import { User as UserType } from './models';`,
			shortName: "UserType",
			want:      "./models",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := r.ResolveClassName("test.ts", []byte(tt.content), tt.shortName, "typescript")
			if got != tt.want {
				t.Errorf("ResolveClassName() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestImportChainResolver_Python(t *testing.T) {
	r := NewImportChainResolver()

	tests := []struct {
		name      string
		content   string
		shortName string
		want      string
	}{
		{
			name:      "from import",
			content:   `from django.db import models`,
			shortName: "models",
			want:      "django.db.models",
		},
		{
			name:      "from import with alias",
			content:   `from numpy import array as np_array`,
			shortName: "np_array",
			want:      "numpy.array",
		},
		{
			name:      "multiple from import",
			content:   `from typing import List, Dict, Optional`,
			shortName: "Dict",
			want:      "typing.Dict",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := r.ResolveClassName("test.py", []byte(tt.content), tt.shortName, "python")
			if got != tt.want {
				t.Errorf("ResolveClassName() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestImportChainResolver_Go(t *testing.T) {
	r := NewImportChainResolver()

	tests := []struct {
		name      string
		content   string
		shortName string
		want      string
	}{
		{
			name: "import block",
			content: `package main

import (
	"fmt"
	"net/http"
)`,
			shortName: "fmt",
			want:      "fmt",
		},
		{
			name: "aliased import",
			content: `package main

import (
	pb "google.golang.org/protobuf/proto"
)`,
			shortName: "pb",
			want:      "google.golang.org/protobuf/proto",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := r.ResolveClassName("test.go", []byte(tt.content), tt.shortName, "go")
			if got != tt.want {
				t.Errorf("ResolveClassName() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestImportChainResolver_Rust(t *testing.T) {
	r := NewImportChainResolver()

	tests := []struct {
		name      string
		content   string
		shortName string
		want      string
	}{
		{
			name:      "simple use",
			content:   `use std::collections::HashMap;`,
			shortName: "HashMap",
			want:      "std::collections::HashMap",
		},
		{
			name:      "group use",
			content:   `use std::io::{Read, Write};`,
			shortName: "Read",
			want:      "std::io::Read",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := r.ResolveClassName("test.rs", []byte(tt.content), tt.shortName, "rust")
			if got != tt.want {
				t.Errorf("ResolveClassName() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCrossFileProvider_OpenTabs(t *testing.T) {
	p := NewCrossFileProvider(nil)

	p.AddOpenTab("/project/file1.go")
	p.AddOpenTab("/project/file2.go")
	p.AddOpenTab("/project/file3.go")

	p.mu.RLock()
	if len(p.openTabs) != 3 {
		t.Errorf("expected 3 open tabs, got %d", len(p.openTabs))
	}
	p.mu.RUnlock()

	p.AddOpenTab("/project/file1.go")
	p.mu.RLock()
	if len(p.openTabs) != 3 {
		t.Errorf("duplicate should not be added, got %d tabs", len(p.openTabs))
	}
	p.mu.RUnlock()

	p.RemoveOpenTab("/project/file2.go")
	p.mu.RLock()
	if len(p.openTabs) != 2 {
		t.Errorf("expected 2 tabs after remove, got %d", len(p.openTabs))
	}
	p.mu.RUnlock()

	newTabs := []string{"/new/a.go", "/new/b.go"}
	p.RegisterOpenTabs(newTabs)
	p.mu.RLock()
	if len(p.openTabs) != 2 {
		t.Errorf("expected 2 tabs after register, got %d", len(p.openTabs))
	}
	p.mu.RUnlock()
}

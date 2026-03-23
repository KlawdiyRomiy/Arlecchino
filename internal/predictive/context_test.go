package predictive

import (
	"testing"
)

func TestContextAnalyzer_Analyze_Language(t *testing.T) {
	analyzer := NewContextAnalyzer()

	tests := []struct {
		filePath string
		content  string
		expected string
	}{
		{"/app/Http/Controllers/UserController.php", "<?php\n", "php"},
		{"/app/Models/User.php", "<?php\n", "php"},
		{"/main.go", "package main\n", "go"},
		{"/internal/service/user.go", "package service\n", "go"},
		{"/src/components/App.tsx", "import React from 'react';\n", "typescriptreact"},
		{"/src/index.ts", "export {};\n", "typescript"},
		{"/src/main.js", "console.log();\n", "javascript"},
		{"/main.py", "print('hello')\n", "python"},
		{"/app/models.py", "class Model:\n    pass\n", "python"},
	}

	for _, tt := range tests {
		t.Run(tt.filePath, func(t *testing.T) {
			ctx := analyzer.Analyze(tt.filePath, []byte(tt.content), 1, 1)
			if ctx.Language != tt.expected {
				t.Errorf("Analyze(%q).Language = %q, want %q", tt.filePath, ctx.Language, tt.expected)
			}
		})
	}
}

func TestContextAnalyzer_Analyze_FileType(t *testing.T) {
	analyzer := NewContextAnalyzer()

	tests := []struct {
		filePath string
		content  string
		expected FileType
	}{
		// PHP/Laravel
		{"/app/Http/Controllers/UserController.php", "<?php\n", FileTypeController},
		{"/app/Models/User.php", "<?php\n", FileTypeModel},
		{"/app/Services/UserService.php", "<?php\n", FileTypeService},
		{"/app/Http/Middleware/Auth.php", "<?php\n", FileTypeMiddleware},
		{"/database/migrations/2024_01_01_create_users.php", "<?php\n", FileTypeMigration},
		{"/tests/Feature/UserTest.php", "<?php\n", FileTypeTest},

		// Go
		{"/internal/controller/user_controller.go", "package controller\n", FileTypeController},
		{"/internal/model/user.go", "package model\n", FileTypeModel},
		{"/internal/service/user_service.go", "package service\n", FileTypeService},
		{"/cmd/main_test.go", "package main\n", FileTypeTest},

		// TypeScript
		{"/src/user.controller.ts", "export class UserController {}\n", FileTypeController},
		{"/src/user.service.ts", "export class UserService {}\n", FileTypeService},
		{"/src/User.test.ts", "describe('User', () => {})\n", FileTypeTest},
	}

	for _, tt := range tests {
		t.Run(tt.filePath, func(t *testing.T) {
			ctx := analyzer.Analyze(tt.filePath, []byte(tt.content), 1, 1)
			if ctx.FileType != tt.expected {
				t.Errorf("Analyze(%q).FileType = %v, want %v", tt.filePath, ctx.FileType, tt.expected)
			}
		})
	}
}

func TestContextAnalyzer_Analyze_IsEmpty(t *testing.T) {
	analyzer := NewContextAnalyzer()

	tests := []struct {
		name     string
		filePath string
		content  string
		expected bool
	}{
		{
			name:     "Empty PHP file",
			filePath: "/app/Test.php",
			content:  "<?php\n\n",
			expected: true,
		},
		{
			name:     "PHP with only namespace",
			filePath: "/app/Test.php",
			content:  "<?php\n\nnamespace App;\n\n",
			expected: true,
		},
		{
			name:     "PHP with class",
			filePath: "/app/Test.php",
			content:  "<?php\n\nnamespace App;\n\nclass Test {}\n",
			expected: false,
		},
		{
			name:     "Empty Go file",
			filePath: "/main.go",
			content:  "package main\n\n",
			expected: true,
		},
		{
			name:     "Go with function",
			filePath: "/main.go",
			content:  "package main\n\nfunc main() {}\n",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := analyzer.Analyze(tt.filePath, []byte(tt.content), 1, 1)
			if ctx.IsEmpty != tt.expected {
				t.Errorf("Analyze(%q).IsEmpty = %v, want %v", tt.filePath, ctx.IsEmpty, tt.expected)
			}
		})
	}
}

func TestContextAnalyzer_Analyze_Framework(t *testing.T) {
	analyzer := NewContextAnalyzer()

	tests := []struct {
		name     string
		filePath string
		content  string
		expected string
	}{
		{
			name:     "Laravel by path",
			filePath: "/app/Http/Controllers/UserController.php",
			content:  "<?php\n\nnamespace App\\Http\\Controllers;\n\nuse Illuminate\\Http\\Request;\n",
			expected: "laravel",
		},
		{
			name:     "NestJS by decorator",
			filePath: "/src/user.controller.ts",
			content:  "import { Controller } from '@nestjs/common';\n\n@Controller()\nexport class UserController {}\n",
			expected: "nestjs",
		},
		{
			name:     "Django by import",
			filePath: "/views.py",
			content:  "from django.views.generic import ListView\n\nclass UserList(ListView):\n    pass\n",
			expected: "django",
		},
		{
			name:     "FastAPI by import",
			filePath: "/main.py",
			content:  "from fastapi import FastAPI\n\napp = FastAPI()\n",
			expected: "fastapi",
		},
		{
			name:     "Gin by import",
			filePath: "/main.go",
			content:  "package main\n\nimport \"github.com/gin-gonic/gin\"\n",
			expected: "gin",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := analyzer.Analyze(tt.filePath, []byte(tt.content), 1, 1)
			if ctx.Framework != tt.expected {
				t.Errorf("Analyze(%q).Framework = %q, want %q", tt.filePath, ctx.Framework, tt.expected)
			}
		})
	}
}

func TestContextAnalyzer_Analyze_Position(t *testing.T) {
	analyzer := NewContextAnalyzer()

	tests := []struct {
		name         string
		filePath     string
		content      string
		line         int
		column       int
		wantInClass  bool
		wantInMethod bool
	}{
		{
			name:     "Inside class body",
			filePath: "/app/Test.php",
			content: `<?php

class Test
{
    
}`,
			line:         5,
			column:       5,
			wantInClass:  true,
			wantInMethod: false,
		},
		{
			name:     "Inside method",
			filePath: "/app/Test.php",
			content: `<?php

class Test
{
    public function foo()
    {
        
    }
}`,
			line:         7,
			column:       9,
			wantInClass:  true,
			wantInMethod: true,
		},
		{
			name:         "At file start",
			filePath:     "/app/Test.php",
			content:      "<?php\n\n",
			line:         2,
			column:       1,
			wantInClass:  false,
			wantInMethod: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := analyzer.Analyze(tt.filePath, []byte(tt.content), tt.line, tt.column)
			if ctx.Position.InClass != tt.wantInClass {
				t.Errorf("Position.InClass = %v, want %v", ctx.Position.InClass, tt.wantInClass)
			}
			if ctx.Position.InMethod != tt.wantInMethod {
				t.Errorf("Position.InMethod = %v, want %v", ctx.Position.InMethod, tt.wantInMethod)
			}
		})
	}
}

func TestContextAnalyzer_Analyze_ClassInfo(t *testing.T) {
	analyzer := NewContextAnalyzer()

	tests := []struct {
		name       string
		filePath   string
		content    string
		wantClass  string
		wantParent string
	}{
		{
			name:     "PHP class with extends",
			filePath: "/app/User.php",
			content: `<?php

namespace App;

class User extends Model
{
}`,
			wantClass:  "User",
			wantParent: "Model",
		},
		{
			name:     "TypeScript class",
			filePath: "/src/user.ts",
			content: `export class UserService extends BaseService {
}`,
			wantClass:  "UserService",
			wantParent: "BaseService",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := analyzer.Analyze(tt.filePath, []byte(tt.content), 1, 1)
			if ctx.ClassName != tt.wantClass {
				t.Errorf("ClassName = %q, want %q", ctx.ClassName, tt.wantClass)
			}
			if ctx.ClassParent != tt.wantParent {
				t.Errorf("ClassParent = %q, want %q", ctx.ClassParent, tt.wantParent)
			}
		})
	}
}

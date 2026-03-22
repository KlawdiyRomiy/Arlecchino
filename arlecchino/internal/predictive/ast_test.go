package predictive

import (
	"testing"
)

func TestASTAnalyzer_PHP(t *testing.T) {
	analyzer := NewASTAnalyzer()
	defer analyzer.Close()

	tests := []struct {
		name         string
		content      string
		line         int
		col          int
		wantClass    string
		wantMethod   string
		wantInClass  bool
		wantInMethod bool
	}{
		{
			name: "Inside class body",
			content: `<?php

namespace App\Models;

class User extends Model
{
    
}`,
			line:         7,
			col:          5,
			wantClass:    "User",
			wantInClass:  true,
			wantInMethod: false,
		},
		{
			name: "Inside method",
			content: `<?php

class UserController extends Controller
{
    public function index()
    {
        
    }
}`,
			line:         7,
			col:          9,
			wantClass:    "UserController",
			wantMethod:   "index",
			wantInClass:  true,
			wantInMethod: true,
		},
		{
			name: "At file start",
			content: `<?php

`,
			line:         2,
			col:          1,
			wantInClass:  false,
			wantInMethod: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, err := analyzer.AnalyzePosition("php", []byte(tt.content), tt.line, tt.col)
			if err != nil {
				t.Fatalf("AnalyzePosition error: %v", err)
			}

			if ctx.ClassName != tt.wantClass {
				t.Errorf("ClassName = %q, want %q", ctx.ClassName, tt.wantClass)
			}
			if ctx.MethodName != tt.wantMethod {
				t.Errorf("MethodName = %q, want %q", ctx.MethodName, tt.wantMethod)
			}
			if ctx.InClass != tt.wantInClass {
				t.Errorf("InClass = %v, want %v", ctx.InClass, tt.wantInClass)
			}
			if ctx.InMethod != tt.wantInMethod {
				t.Errorf("InMethod = %v, want %v", ctx.InMethod, tt.wantInMethod)
			}
		})
	}
}

func TestASTAnalyzer_Go(t *testing.T) {
	analyzer := NewASTAnalyzer()
	defer analyzer.Close()

	tests := []struct {
		name         string
		content      string
		line         int
		col          int
		wantClass    string
		wantMethod   string
		wantFunction string
		wantInMethod bool
	}{
		{
			name: "Inside struct method",
			content: `package service

type UserService struct{}

func (s *UserService) GetUser(id int) (*User, error) {
	
}`,
			line:         6,
			col:          1,
			wantClass:    "UserService",
			wantMethod:   "GetUser",
			wantInMethod: true,
		},
		{
			name: "Inside function",
			content: `package main

func main() {
	
}`,
			line:         4,
			col:          1,
			wantFunction: "main",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, err := analyzer.AnalyzePosition("go", []byte(tt.content), tt.line, tt.col)
			if err != nil {
				t.Fatalf("AnalyzePosition error: %v", err)
			}

			if ctx.ClassName != tt.wantClass {
				t.Errorf("ClassName = %q, want %q", ctx.ClassName, tt.wantClass)
			}
			if ctx.MethodName != tt.wantMethod {
				t.Errorf("MethodName = %q, want %q", ctx.MethodName, tt.wantMethod)
			}
			if ctx.FunctionName != tt.wantFunction {
				t.Errorf("FunctionName = %q, want %q", ctx.FunctionName, tt.wantFunction)
			}
		})
	}
}

func TestASTAnalyzer_TypeScript(t *testing.T) {
	analyzer := NewASTAnalyzer()
	defer analyzer.Close()

	tests := []struct {
		name        string
		content     string
		line        int
		col         int
		wantClass   string
		wantParent  string
		wantInClass bool
	}{
		{
			name: "NestJS controller class",
			content: `import { Controller } from '@nestjs/common';

@Controller('users')
export class UsersController {
    
}`,
			line:        5,
			col:         5,
			wantClass:   "UsersController",
			wantInClass: true,
		},
		{
			name: "Class with extends",
			content: `export class AppService extends BaseService {
    
}`,
			line:        2,
			col:         5,
			wantClass:   "AppService",
			wantParent:  "BaseService",
			wantInClass: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, err := analyzer.AnalyzePosition("typescript", []byte(tt.content), tt.line, tt.col)
			if err != nil {
				t.Fatalf("AnalyzePosition error: %v", err)
			}

			if ctx.ClassName != tt.wantClass {
				t.Errorf("ClassName = %q, want %q", ctx.ClassName, tt.wantClass)
			}
			if ctx.ParentClass != tt.wantParent {
				t.Errorf("ParentClass = %q, want %q", ctx.ParentClass, tt.wantParent)
			}
			if ctx.InClass != tt.wantInClass {
				t.Errorf("InClass = %v, want %v", ctx.InClass, tt.wantInClass)
			}
		})
	}
}

func TestASTAnalyzer_Python(t *testing.T) {
	analyzer := NewASTAnalyzer()
	defer analyzer.Close()

	tests := []struct {
		name        string
		content     string
		line        int
		col         int
		wantClass   string
		wantMethod  string
		wantInClass bool
	}{
		{
			name: "Django view class",
			content: `from django.views.generic import ListView

class UserListView(ListView):
    model = User
`,
			line:        4, // Inside class body, on the "model = User" line
			col:         5,
			wantClass:   "UserListView",
			wantInClass: true,
		},
		{
			name: "Inside method",
			content: `class MyClass:
    def my_method(self):
        x = 1
`,
			line:        3, // Inside method body, on the "x = 1" line
			col:         9,
			wantClass:   "MyClass",
			wantMethod:  "my_method",
			wantInClass: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, err := analyzer.AnalyzePosition("python", []byte(tt.content), tt.line, tt.col)
			if err != nil {
				t.Fatalf("AnalyzePosition error: %v", err)
			}

			if ctx.ClassName != tt.wantClass {
				t.Errorf("ClassName = %q, want %q", ctx.ClassName, tt.wantClass)
			}
			if ctx.MethodName != tt.wantMethod {
				t.Errorf("MethodName = %q, want %q", ctx.MethodName, tt.wantMethod)
			}
			if ctx.InClass != tt.wantInClass {
				t.Errorf("InClass = %v, want %v", ctx.InClass, tt.wantInClass)
			}
		})
	}
}

func TestASTAnalyzer_Ruby(t *testing.T) {
	analyzer := NewASTAnalyzer()
	defer analyzer.Close()

	tests := []struct {
		name         string
		content      string
		line         int
		col          int
		wantClass    string
		wantMethod   string
		wantParent   string
		wantInClass  bool
		wantInMethod bool
	}{
		{
			name: "Inside class body",
			content: `class User < ApplicationRecord
  
end`,
			line:        2,
			col:         3,
			wantClass:   "User",
			wantParent:  "ApplicationRecord",
			wantInClass: true,
		},
		{
			name: "Inside method",
			content: `class UsersController < ApplicationController
  def index
    @users = User.all
  end
end`,
			line:         3,
			col:          5,
			wantClass:    "UsersController",
			wantMethod:   "index",
			wantParent:   "ApplicationController",
			wantInClass:  true,
			wantInMethod: true,
		},
		{
			name: "Module with class method",
			content: `module Authentication
  def self.sign_in(user)
    session[:user_id] = user.id
  end
end`,
			line:         3,
			col:          5,
			wantClass:    "Authentication",
			wantMethod:   "sign_in",
			wantInClass:  true,
			wantInMethod: true,
		},
		{
			name: "Simple class no parent",
			content: `class Config
  attr_accessor :setting
end`,
			line:        2,
			col:         3,
			wantClass:   "Config",
			wantInClass: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, err := analyzer.AnalyzePosition("ruby", []byte(tt.content), tt.line, tt.col)
			if err != nil {
				t.Fatalf("AnalyzePosition error: %v", err)
			}

			if ctx.ClassName != tt.wantClass {
				t.Errorf("ClassName = %q, want %q", ctx.ClassName, tt.wantClass)
			}
			if ctx.MethodName != tt.wantMethod {
				t.Errorf("MethodName = %q, want %q", ctx.MethodName, tt.wantMethod)
			}
			if ctx.ParentClass != tt.wantParent {
				t.Errorf("ParentClass = %q, want %q", ctx.ParentClass, tt.wantParent)
			}
			if ctx.InClass != tt.wantInClass {
				t.Errorf("InClass = %v, want %v", ctx.InClass, tt.wantInClass)
			}
			if ctx.InMethod != tt.wantInMethod {
				t.Errorf("InMethod = %v, want %v", ctx.InMethod, tt.wantInMethod)
			}
		})
	}
}

func TestExtractPrefixWithAccessChain(t *testing.T) {
	tests := []struct {
		name       string
		language   string
		content    string
		line       int
		col        int
		wantPrefix string
		wantChain  string
	}{
		// PHP static calls (::)
		{
			name:       "PHP Route:: empty prefix",
			content:    "Route::",
			line:       1,
			col:        8, // right after ::
			wantPrefix: "",
			wantChain:  "Route::",
		},
		{
			name:       "PHP Route::g partial prefix",
			content:    "Route::g",
			line:       1,
			col:        9,
			wantPrefix: "g",
			wantChain:  "Route::",
		},
		{
			name:       "PHP Route::get full method",
			content:    "Route::get",
			line:       1,
			col:        11,
			wantPrefix: "get",
			wantChain:  "Route::",
		},
		{
			name:       "PHP namespaced class static",
			content:    "App\\Models\\User::",
			line:       1,
			col:        18,
			wantPrefix: "",
			wantChain:  "App\\Models\\User::",
		},
		// PHP method calls (->)
		{
			name:       "PHP this-> empty prefix",
			content:    "$this->",
			line:       1,
			col:        8,
			wantPrefix: "",
			wantChain:  "$this->",
		},
		{
			name:       "PHP this->m partial prefix",
			content:    "$this->m",
			line:       1,
			col:        9,
			wantPrefix: "m",
			wantChain:  "$this->",
		},
		{
			name:       "PHP variable method call",
			content:    "$user->getName",
			line:       1,
			col:        15,
			wantPrefix: "getName",
			wantChain:  "$user->",
		},
		// Go/JS/Python dot access (.)
		{
			name:       "Go http. empty",
			content:    "http.",
			line:       1,
			col:        6,
			wantPrefix: "",
			wantChain:  "http.",
		},
		{
			name:       "Go http.Get",
			content:    "http.Get",
			line:       1,
			col:        9,
			wantPrefix: "Get",
			wantChain:  "http.",
		},
		{
			name:       "JS Math.floor",
			content:    "Math.floor",
			line:       1,
			col:        11,
			wantPrefix: "floor",
			wantChain:  "Math.",
		},
		{
			name:       "Python os.path",
			content:    "os.path",
			line:       1,
			col:        8,
			wantPrefix: "path",
			wantChain:  "os.",
		},
		{
			name:       "Python dotted access after assignment",
			language:   "python",
			content:    "result = json.du",
			line:       1,
			col:        17,
			wantPrefix: "du",
			wantChain:  "json.",
		},
		{
			name:       "Ruby dotted access after assignment",
			language:   "ruby",
			content:    "result = JSON.p",
			line:       1,
			col:        16,
			wantPrefix: "p",
			wantChain:  "JSON.",
		},
		{
			name:       "TypeScript dotted access after assignment",
			language:   "typescript",
			content:    "const v = console.l",
			line:       1,
			col:        20,
			wantPrefix: "l",
			wantChain:  "console.",
		},
		// Edge cases
		{
			name:       "No access chain - simple identifier",
			content:    "foo",
			line:       1,
			col:        4,
			wantPrefix: "foo",
			wantChain:  "",
		},
		{
			name:       "Chained access with spaces",
			content:    "Route :: get",
			line:       1,
			col:        13, // after "get"
			wantPrefix: "get",
			wantChain:  "Route ::",
		},
		// Multiline scenarios
		{
			name:       "Multiline - access on line 2",
			content:    "<?php\nRoute::get",
			line:       2,
			col:        11,
			wantPrefix: "get",
			wantChain:  "Route::",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			language := tt.language
			if language == "" {
				language = "php"
			}
			prefix, chain := extractPrefixWithAccessChain([]byte(tt.content), tt.line, tt.col, language)
			if prefix != tt.wantPrefix {
				t.Errorf("prefix = %q, want %q", prefix, tt.wantPrefix)
			}
			if chain != tt.wantChain {
				t.Errorf("accessChain = %q, want %q", chain, tt.wantChain)
			}
		})
	}
}

func TestASTAnalyzer_TopLevel(t *testing.T) {
	analyzer := NewASTAnalyzer()
	defer analyzer.Close()

	tests := []struct {
		name        string
		language    string
		content     string
		line        int
		col         int
		wantContext PositionContext
	}{
		{
			name:     "Laravel route file - Route::",
			language: "php",
			content: `<?php

use Illuminate\Support\Facades\Route;

Route::`,
			line:        5,
			col:         8,
			wantContext: PositionContextTopLevel,
		},
		{
			name:     "Laravel route file - Route::get",
			language: "php",
			content: `<?php

use Illuminate\Support\Facades\Route;

Route::get('/users', function () {
    return 'users';
});`,
			line:        5,
			col:         11,
			wantContext: PositionContextTopLevel,
		},
		{
			name:     "PHP file - after imports, empty line",
			language: "php",
			content: `<?php

use App\Models\User;

`,
			line:        5,
			col:         1,
			wantContext: PositionContextAfterImports,
		},
		{
			name:     "Python module level code",
			language: "python",
			content: `import os
import sys

print("hello")`,
			line:        4,
			col:         5,
			wantContext: PositionContextTopLevel,
		},
		{
			name:     "TypeScript module level",
			language: "typescript",
			content: `import express from 'express';

const app = express();`,
			line:        3,
			col:         10,
			wantContext: PositionContextTopLevel,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, err := analyzer.AnalyzePosition(tt.language, []byte(tt.content), tt.line, tt.col)
			if err != nil {
				t.Fatalf("AnalyzePosition error: %v", err)
			}

			if ctx.Context != tt.wantContext {
				t.Errorf("Context = %q, want %q (nodeType=%s, parentType=%s)",
					ctx.Context, tt.wantContext, ctx.NodeType, ctx.ParentType)
			}
		})
	}
}

func TestASTAnalyzer_Namespace(t *testing.T) {
	analyzer := NewASTAnalyzer()
	defer analyzer.Close()

	tests := []struct {
		name        string
		language    string
		content     string
		wantNS      string
		wantImports []string
	}{
		{
			name:     "PHP namespace",
			language: "php",
			content: `<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\User;

class UserController {}`,
			wantNS:      "App\\Http\\Controllers",
			wantImports: []string{"Illuminate\\Http\\Request", "App\\Models\\User"},
		},
		{
			name:     "Go package",
			language: "go",
			content: `package main

import (
	"fmt"
	"net/http"
)

func main() {}`,
			wantNS:      "main",
			wantImports: []string{"fmt", "net/http"},
		},
		{
			name:     "TypeScript imports",
			language: "typescript",
			content: `import { Controller } from '@nestjs/common';
import { UserService } from './user.service';

@Controller()
export class AppController {}`,
			wantImports: []string{"@nestjs/common", "./user.service"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, err := analyzer.AnalyzePosition(tt.language, []byte(tt.content), 1, 1)
			if err != nil {
				t.Fatalf("AnalyzePosition error: %v", err)
			}

			if tt.wantNS != "" && ctx.Namespace != tt.wantNS {
				t.Errorf("Namespace = %q, want %q", ctx.Namespace, tt.wantNS)
			}

			if len(tt.wantImports) > 0 {
				if len(ctx.Imports) < len(tt.wantImports) {
					t.Errorf("Imports = %v, want at least %v", ctx.Imports, tt.wantImports)
				}
			}
		})
	}
}

func TestExtractPrefixAtPosition_RouteStaticCall(t *testing.T) {
	analyzer := NewASTAnalyzer()
	defer analyzer.Close()

	content := []byte(`<?php

use Illuminate\Support\Facades\Route;

Route::g`)

	// Line 5, column 9 (after "Route::g")
	prefix, inString, stringContent, accessChain, inComment, inImport, stringCtxType := analyzer.ExtractPrefixAtPosition(
		"php", content, 5, 9,
	)

	t.Logf("prefix=%q accessChain=%q inString=%v inComment=%v inImport=%v stringContent=%q stringCtxType=%q",
		prefix, accessChain, inString, inComment, inImport, stringContent, stringCtxType)

	if prefix != "g" {
		t.Errorf("expected prefix 'g', got %q", prefix)
	}

	if accessChain != "Route::" {
		t.Errorf("expected accessChain 'Route::', got %q", accessChain)
	}

	if inString {
		t.Error("should not be in string")
	}

	if inComment {
		t.Error("should not be in comment")
	}
}

func TestExtractPrefixAtPosition_RouteNoMethod(t *testing.T) {
	analyzer := NewASTAnalyzer()
	defer analyzer.Close()

	content := []byte(`<?php

use Illuminate\Support\Facades\Route;

Route::`)

	// Line 5, column 8 (right after "::")
	prefix, inString, _, accessChain, inComment, _, _ := analyzer.ExtractPrefixAtPosition(
		"php", content, 5, 8,
	)

	t.Logf("prefix=%q accessChain=%q inString=%v inComment=%v", prefix, accessChain, inString, inComment)

	if prefix != "" {
		t.Errorf("expected empty prefix, got %q", prefix)
	}

	if accessChain != "Route::" {
		t.Errorf("expected accessChain 'Route::', got %q", accessChain)
	}
}

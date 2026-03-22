package predictive

import (
	"strings"
	"testing"
)

func TestScaffoldGenerator_PHP(t *testing.T) {
	gen := NewGenerator()

	tests := []struct {
		name     string
		ctx      *FileContext
		pattern  *Pattern
		contains []string
	}{
		{
			name: "Laravel Controller",
			ctx: &FileContext{
				Language:  "php",
				Framework: "laravel",
				FileType:  FileTypeController,
				FilePath:  "/app/Http/Controllers/UserController.php",
			},
			pattern: &Pattern{
				ID:        "laravel-controller",
				Generator: "laravel-controller",
			},
			contains: []string{
				"namespace",
				"class",
				"Controller",
			},
		},
		{
			name: "Laravel Model",
			ctx: &FileContext{
				Language:  "php",
				Framework: "laravel",
				FileType:  FileTypeModel,
				FilePath:  "/app/Models/User.php",
			},
			pattern: &Pattern{
				ID:        "laravel-model",
				Generator: "laravel-model",
			},
			contains: []string{
				"namespace",
				"class",
				"Model",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code := gen.Generate(tt.ctx, tt.pattern)

			if code == "" {
				t.Skip("Generator not implemented for this combination")
			}

			for _, want := range tt.contains {
				if !strings.Contains(code, want) {
					t.Errorf("Generated code missing %q", want)
				}
			}
		})
	}
}

func TestScaffoldGenerator_Go(t *testing.T) {
	gen := NewGenerator()

	tests := []struct {
		name     string
		ctx      *FileContext
		pattern  *Pattern
		contains []string
	}{
		{
			name: "Go Service",
			ctx: &FileContext{
				Language:  "go",
				Framework: "gin",
				FileType:  FileTypeService,
				FilePath:  "/internal/service/user.go",
			},
			pattern: &Pattern{
				ID:        "go-service",
				Generator: "go-service",
			},
			contains: []string{
				"package",
				"type",
				"struct",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code := gen.Generate(tt.ctx, tt.pattern)

			if code == "" {
				t.Skip("Generator not implemented for this combination")
			}

			for _, want := range tt.contains {
				if !strings.Contains(code, want) {
					t.Errorf("Generated code missing %q", want)
				}
			}
		})
	}
}

func TestScaffoldGenerator_TypeScript(t *testing.T) {
	gen := NewGenerator()

	tests := []struct {
		name     string
		ctx      *FileContext
		pattern  *Pattern
		contains []string
	}{
		{
			name: "NestJS Controller",
			ctx: &FileContext{
				Language:  "typescript",
				Framework: "nestjs",
				FileType:  FileTypeController,
				FilePath:  "/src/user/user.controller.ts",
			},
			pattern: &Pattern{
				ID:        "nestjs-controller",
				Generator: "nestjs-controller",
			},
			contains: []string{
				"import",
				"Controller",
				"class",
			},
		},
		{
			name: "NestJS Service",
			ctx: &FileContext{
				Language:  "typescript",
				Framework: "nestjs",
				FileType:  FileTypeService,
				FilePath:  "/src/user/user.service.ts",
			},
			pattern: &Pattern{
				ID:        "nestjs-service",
				Generator: "nestjs-service",
			},
			contains: []string{
				"import",
				"Injectable",
				"class",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code := gen.Generate(tt.ctx, tt.pattern)

			if code == "" {
				t.Skip("Generator not implemented for this combination")
			}

			for _, want := range tt.contains {
				if !strings.Contains(code, want) {
					t.Errorf("Generated code missing %q", want)
				}
			}
		})
	}
}

func TestScaffoldGenerator_Python(t *testing.T) {
	gen := NewGenerator()

	tests := []struct {
		name     string
		ctx      *FileContext
		pattern  *Pattern
		contains []string
	}{
		{
			name: "Django View",
			ctx: &FileContext{
				Language:  "python",
				Framework: "django",
				FileType:  FileTypeController,
				FilePath:  "/app/views/user.py",
			},
			pattern: &Pattern{
				ID:        "django-view",
				Generator: "django-view",
			},
			contains: []string{
				"from django",
				"class",
				"View",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code := gen.Generate(tt.ctx, tt.pattern)

			if code == "" {
				t.Skip("Generator not implemented for this combination")
			}

			for _, want := range tt.contains {
				if !strings.Contains(code, want) {
					t.Errorf("Generated code missing %q", want)
				}
			}
		})
	}
}

func TestGenerator_Template(t *testing.T) {
	gen := NewGenerator()

	ctx := &FileContext{
		FilePath:  "/app/Services/UserService.php",
		Language:  "php",
		Framework: "laravel",
		Namespace: "App\\Services",
		ClassName: "UserService",
	}

	pattern := &Pattern{
		ID:       "template-test",
		Template: "<?php\n\nnamespace ${namespace};\n\nclass ${className}\n{\n    // code\n}",
	}

	code := gen.Generate(ctx, pattern)

	if !strings.Contains(code, "namespace App\\Services") {
		t.Error("Template variable ${namespace} not replaced")
	}

	if !strings.Contains(code, "class UserService") {
		t.Error("Template variable ${className} not replaced")
	}
}

func TestGenerator_ClassNameFromPath(t *testing.T) {
	gen := NewGenerator()

	tests := []struct {
		filePath string
		want     string
	}{
		{"/app/Http/Controllers/UserController.php", "UserController"},
		{"/app/Models/User.php", "User"},
		{"/src/user/user.service.ts", "UserService"},
		{"/internal/service/order_service.go", "OrderService"},
		{"user_controller.py", "UserController"},
	}

	for _, tt := range tests {
		t.Run(tt.filePath, func(t *testing.T) {
			got := gen.classNameFromPath(tt.filePath)

			if got != tt.want {
				t.Errorf("classNameFromPath(%q) = %q, want %q", tt.filePath, got, tt.want)
			}
		})
	}
}

func TestToPascalCase(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"user_controller", "UserController"},
		{"order-service", "OrderService"},
		{"user", "User"},
		{"my_test_class", "MyTestClass"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := toPascalCase(tt.input)
			if got != tt.want {
				t.Errorf("toPascalCase(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

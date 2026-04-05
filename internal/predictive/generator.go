package predictive

import (
	"path/filepath"
	"regexp"
	"strings"
)

type Generator struct {
	generators     map[string]GeneratorFunc
	smartfill      *EnhancedPlaceholderResolver
	symbolProvider SymbolProvider
}

type GeneratorFunc func(ctx *FileContext, pattern *Pattern) string

type GenerationMetadata struct {
	HasResolvedData      bool
	UsesFallbackDefaults bool
}

func NewGenerator() *Generator {
	g := &Generator{
		generators: make(map[string]GeneratorFunc),
		smartfill:  NewEnhancedPlaceholderResolver(),
	}
	g.registerBuiltinGenerators()
	return g
}

func (g *Generator) SetSymbolProvider(sp SymbolProvider) {
	g.symbolProvider = sp
	g.smartfill.SetSymbolProvider(sp)
}

func (g *Generator) RegisterPluginProvider(provider PluginResolverProvider) {
	g.smartfill.RegisterPluginProvider(provider)
}

// Register adds a generator function
func (g *Generator) Register(id string, fn GeneratorFunc) {
	g.generators[id] = fn
}

// Generate generates code for a pattern
func (g *Generator) Generate(ctx *FileContext, pattern *Pattern) string {
	code, _ := g.GenerateWithMetadata(ctx, pattern)
	return code
}

func (g *Generator) GenerateWithMetadata(ctx *FileContext, pattern *Pattern) (string, GenerationMetadata) {
	// If pattern has a template, use it directly
	if pattern.Template != "" {
		return g.processTemplate(pattern.Template, ctx, pattern)
	}

	// Otherwise, use a registered generator
	if fn, ok := g.generators[pattern.Generator]; ok {
		return fn(ctx, pattern), GenerationMetadata{}
	}

	return "", GenerationMetadata{}
}

func (g *Generator) processTemplate(template string, ctx *FileContext, pattern *Pattern) (string, GenerationMetadata) {
	result := template

	className := ctx.ClassName
	if className == "" {
		className = g.classNameFromPath(ctx.FilePath)
	}

	replacements := map[string]string{
		"${className}": className,
		"${namespace}": ctx.Namespace,
		"${fileName}":  filepath.Base(ctx.FilePath),
		"${language}":  ctx.Language,
		"${framework}": ctx.Framework,
	}

	for key, value := range replacements {
		result = strings.ReplaceAll(result, key, value)
	}

	for key, value := range pattern.Variables {
		result = strings.ReplaceAll(result, "${"+key+"}", value)
	}

	result, stats := g.smartfill.ResolvePlaceholdersWithStats(result, ctx)

	return result, GenerationMetadata{
		HasResolvedData:      stats.HasResolvedData(),
		UsesFallbackDefaults: stats.UsesFallbackDefaults(),
	}
}

// classNameFromPath extracts class name from file path
func (g *Generator) classNameFromPath(filePath string) string {
	base := filepath.Base(filePath)
	ext := filepath.Ext(base)
	name := strings.TrimSuffix(base, ext)

	// Handle common suffixes
	name = strings.TrimSuffix(name, ".blade")

	// Convert to PascalCase
	return toPascalCase(name)
}

// toPascalCase converts string to PascalCase
func toPascalCase(s string) string {
	// Split by common separators (including dots for files like user.service.ts)
	parts := regexp.MustCompile(`[-_.\s]+`).Split(s, -1)
	var result strings.Builder

	for _, part := range parts {
		if len(part) > 0 {
			result.WriteString(strings.ToUpper(string(part[0])))
			if len(part) > 1 {
				result.WriteString(part[1:])
			}
		}
	}

	return result.String()
}

// registerBuiltinGenerators registers all built-in generators
func (g *Generator) registerBuiltinGenerators() {
	// Laravel generators
	g.Register("laravel_controller_scaffold", g.laravelControllerScaffold)
	g.Register("laravel_model_scaffold", g.laravelModelScaffold)
	g.Register("laravel_service_scaffold", g.laravelServiceScaffold)
	g.Register("laravel_migration_scaffold", g.laravelMigrationScaffold)
	g.Register("laravel_request_scaffold", g.laravelRequestScaffold)
	g.Register("laravel_test_scaffold", g.laravelTestScaffold)

	// React generators
	g.Register("react_component_scaffold", g.reactComponentScaffold)

	// NestJS generators
	g.Register("nestjs_controller_scaffold", g.nestjsControllerScaffold)
	g.Register("nestjs_service_scaffold", g.nestjsServiceScaffold)

	// Django generators
	g.Register("django_view_scaffold", g.djangoViewScaffold)
	g.Register("django_model_scaffold", g.djangoModelScaffold)
}

// ======================
// Laravel Generators
// ======================

// extractModelName extracts model name from controller/service name
// UserController -> User, PostsController -> Post, UsersController -> User
func (g *Generator) extractModelName(className string) string {
	// Remove common suffixes
	name := strings.TrimSuffix(className, "Controller")
	name = strings.TrimSuffix(name, "Service")
	name = strings.TrimSuffix(name, "Repository")
	name = strings.TrimSuffix(name, "Request")

	// Handle plural forms (simple cases)
	if strings.HasSuffix(name, "ies") {
		// Categories -> Category
		name = strings.TrimSuffix(name, "ies") + "y"
	} else if strings.HasSuffix(name, "ses") || strings.HasSuffix(name, "xes") || strings.HasSuffix(name, "ches") || strings.HasSuffix(name, "shes") {
		// Boxes -> Box, Matches -> Match
		name = strings.TrimSuffix(name, "es")
	} else if strings.HasSuffix(name, "s") && !strings.HasSuffix(name, "ss") {
		// Users -> User (but not Class -> Clas)
		name = strings.TrimSuffix(name, "s")
	}

	return name
}

// toSnakeCase converts PascalCase to snake_case
func toSnakeCase(s string) string {
	var result strings.Builder
	for i, r := range s {
		if i > 0 && r >= 'A' && r <= 'Z' {
			result.WriteRune('_')
		}
		result.WriteRune(r)
	}
	return strings.ToLower(result.String())
}

// toLowerFirst converts first letter to lowercase
func toLowerFirst(s string) string {
	if len(s) == 0 {
		return s
	}
	return strings.ToLower(string(s[0])) + s[1:]
}

func (g *Generator) laravelControllerScaffold(ctx *FileContext, pattern *Pattern) string {
	className := g.classNameFromPath(ctx.FilePath)
	namespace := ctx.Namespace
	if namespace == "" {
		namespace = "App\\Http\\Controllers"
	}

	// Extract model name from controller name
	modelName := g.extractModelName(className)
	modelVar := toLowerFirst(modelName)
	routeParam := toSnakeCase(modelName)

	return `<?php

namespace ` + namespace + `;

use App\Models\\` + modelName + `;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class ` + className + ` extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(): JsonResponse
    {
        $` + modelVar + `s = ` + modelName + `::all();
        
        return response()->json($` + modelVar + `s);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request): JsonResponse
    {
        $` + modelVar + ` = ` + modelName + `::create($request->validated());
        
        return response()->json($` + modelVar + `, 201);
    }

    /**
     * Display the specified resource.
     */
    public function show(` + modelName + ` $` + routeParam + `): JsonResponse
    {
        return response()->json($` + routeParam + `);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, ` + modelName + ` $` + routeParam + `): JsonResponse
    {
        $` + routeParam + `->update($request->validated());
        
        return response()->json($` + routeParam + `);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(` + modelName + ` $` + routeParam + `): JsonResponse
    {
        $` + routeParam + `->delete();
        
        return response()->json(null, 204);
    }
}`
}

func (g *Generator) laravelModelScaffold(ctx *FileContext, pattern *Pattern) string {
	className := g.classNameFromPath(ctx.FilePath)
	namespace := ctx.Namespace
	if namespace == "" {
		namespace = "App\\Models"
	}

	return `<?php

namespace ` + namespace + `;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ` + className + ` extends Model
{
    use HasFactory;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        $1
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        $2
    ];
}`
}

func (g *Generator) laravelServiceScaffold(ctx *FileContext, pattern *Pattern) string {
	className := g.classNameFromPath(ctx.FilePath)
	namespace := ctx.Namespace
	if namespace == "" {
		namespace = "App\\Services"
	}

	// Extract model name using improved extraction
	modelName := g.extractModelName(className)
	modelVar := toLowerFirst(modelName)

	return `<?php

namespace ` + namespace + `;

use App\Models\\` + modelName + `;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Pagination\LengthAwarePaginator;

class ` + className + `
{
    /**
     * Get paginated items.
     */
    public function paginate(int $perPage = 15): LengthAwarePaginator
    {
        return ` + modelName + `::latest()->paginate($perPage);
    }

    /**
     * Get all items.
     */
    public function all(): Collection
    {
        return ` + modelName + `::all();
    }

    /**
     * Find item by ID.
     */
    public function find(int $id): ?` + modelName + `
    {
        return ` + modelName + `::find($id);
    }

    /**
     * Find item by ID or fail.
     */
    public function findOrFail(int $id): ` + modelName + `
    {
        return ` + modelName + `::findOrFail($id);
    }

    /**
     * Create new item.
     */
    public function create(array $data): ` + modelName + `
    {
        return ` + modelName + `::create($data);
    }

    /**
     * Update existing item.
     */
    public function update(` + modelName + ` $` + modelVar + `, array $data): ` + modelName + `
    {
        $` + modelVar + `->update($data);
        
        return $` + modelVar + `->fresh();
    }

    /**
     * Delete item.
     */
    public function delete(` + modelName + ` $` + modelVar + `): bool
    {
        return $` + modelVar + `->delete();
    }
}`
}

func (g *Generator) laravelMigrationScaffold(ctx *FileContext, pattern *Pattern) string {
	// Extract table name from file name
	fileName := filepath.Base(ctx.FilePath)
	tableName := extractTableName(fileName)

	return `<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('` + tableName + `', function (Blueprint $table) {
            $table->id();
            $1
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('` + tableName + `');
    }
};`
}

func (g *Generator) laravelRequestScaffold(ctx *FileContext, pattern *Pattern) string {
	className := g.classNameFromPath(ctx.FilePath)
	namespace := ctx.Namespace
	if namespace == "" {
		namespace = "App\\Http\\Requests"
	}

	return `<?php

namespace ` + namespace + `;

use Illuminate\Foundation\Http\FormRequest;

class ` + className + ` extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            $1
        ];
    }

    /**
     * Get custom messages for validator errors.
     *
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            $2
        ];
    }
}`
}

func (g *Generator) laravelTestScaffold(ctx *FileContext, pattern *Pattern) string {
	className := g.classNameFromPath(ctx.FilePath)
	namespace := ctx.Namespace
	if namespace == "" {
		namespace = "Tests\\Feature"
	}

	return `<?php

namespace ` + namespace + `;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\WithFaker;
use Tests\TestCase;

class ` + className + ` extends TestCase
{
    use RefreshDatabase, WithFaker;

    /**
     * Test example.
     */
    public function test_example(): void
    {
        $response = $this->get('/');

        $response->assertStatus(200);
    }

    $1
}`
}

// ======================
// React Generators
// ======================

func (g *Generator) reactComponentScaffold(ctx *FileContext, pattern *Pattern) string {
	componentName := g.classNameFromPath(ctx.FilePath)

	return `import React from 'react';

interface ` + componentName + `Props {
    $1
}

export const ` + componentName + `: React.FC<` + componentName + `Props> = (props) => {
    return (
        <div>
            $2
        </div>
    );
};

export default ` + componentName + `;`
}

// ======================
// NestJS Generators
// ======================

func (g *Generator) nestjsControllerScaffold(ctx *FileContext, pattern *Pattern) string {
	className := g.classNameFromPath(ctx.FilePath)
	serviceName := strings.TrimSuffix(className, "Controller") + "Service"
	routePath := strings.ToLower(strings.TrimSuffix(className, "Controller"))

	return `import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ` + serviceName + ` } from './' + ` + strings.ToLower(serviceName) + `';

@Controller('` + routePath + `')
export class ` + className + ` {
    constructor(private readonly service: ` + serviceName + `) {}

    @Get()
    async findAll() {
        return this.service.findAll();
    }

    @Get(':id')
    async findOne(@Param('id') id: string) {
        return this.service.findOne(+id);
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    async create(@Body() data: any) {
        return this.service.create(data);
    }

    @Put(':id')
    async update(@Param('id') id: string, @Body() data: any) {
        return this.service.update(+id, data);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    async remove(@Param('id') id: string) {
        return this.service.remove(+id);
    }
}`
}

func (g *Generator) nestjsServiceScaffold(ctx *FileContext, pattern *Pattern) string {
	className := g.classNameFromPath(ctx.FilePath)

	return `import { Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class ` + className + ` {
    private items: any[] = [];

    async findAll(): Promise<any[]> {
        return this.items;
    }

    async findOne(id: number): Promise<any> {
        const item = this.items.find(i => i.id === id);
        if (!item) {
            throw new NotFoundException();
        }
        return item;
    }

    async create(data: any): Promise<any> {
        const item = { id: Date.now(), ...data };
        this.items.push(item);
        return item;
    }

    async update(id: number, data: any): Promise<any> {
        const index = this.items.findIndex(i => i.id === id);
        if (index === -1) {
            throw new NotFoundException();
        }
        this.items[index] = { ...this.items[index], ...data };
        return this.items[index];
    }

    async remove(id: number): Promise<void> {
        const index = this.items.findIndex(i => i.id === id);
        if (index === -1) {
            throw new NotFoundException();
        }
        this.items.splice(index, 1);
    }
}`
}

// ======================
// Django Generators
// ======================

func (g *Generator) djangoViewScaffold(ctx *FileContext, pattern *Pattern) string {
	className := g.classNameFromPath(ctx.FilePath)

	return `from django.views.generic import ListView, DetailView, CreateView, UpdateView, DeleteView
from django.urls import reverse_lazy
from .models import $1

class ` + className + `ListView(ListView):
    model = $1
    template_name = '$2_list.html'
    context_object_name = 'items'
    paginate_by = 10

class ` + className + `DetailView(DetailView):
    model = $1
    template_name = '$2_detail.html'
    context_object_name = 'item'

class ` + className + `CreateView(CreateView):
    model = $1
    template_name = '$2_form.html'
    fields = ['$3']
    success_url = reverse_lazy('$2_list')

class ` + className + `UpdateView(UpdateView):
    model = $1
    template_name = '$2_form.html'
    fields = ['$3']
    success_url = reverse_lazy('$2_list')

class ` + className + `DeleteView(DeleteView):
    model = $1
    template_name = '$2_confirm_delete.html'
    success_url = reverse_lazy('$2_list')`
}

func (g *Generator) djangoModelScaffold(ctx *FileContext, pattern *Pattern) string {
	className := g.classNameFromPath(ctx.FilePath)

	return `from django.db import models
from django.utils.translation import gettext_lazy as _

class ` + className + `(models.Model):
    """
    ` + className + ` model.
    """
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _('` + className + `')
        verbose_name_plural = _('` + className + `s')
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.id}'

    $1`
}

// ======================
// Helpers
// ======================

// extractTableName extracts table name from migration file name
func extractTableName(fileName string) string {
	// Remove date prefix and extension
	// e.g., "2024_01_01_000000_create_users_table.php" -> "users"
	name := strings.TrimSuffix(fileName, ".php")
	parts := strings.Split(name, "_")

	// Find "create" and "table" positions
	createIdx := -1
	tableIdx := -1
	for i, p := range parts {
		if p == "create" {
			createIdx = i
		}
		if p == "table" {
			tableIdx = i
		}
	}

	if createIdx >= 0 && tableIdx > createIdx {
		tableParts := parts[createIdx+1 : tableIdx]
		return strings.Join(tableParts, "_")
	}

	// Fallback: just use last meaningful part
	if len(parts) > 4 {
		return parts[len(parts)-2]
	}

	return "items"
}

import { GoToDefinition } from "../../wailsjs/go/main/App";

export interface DefinitionItem {
  path: string;
  line?: number;
  context?: string;
  displayPath?: string;
}

/**
 * Find definitions using backend Go to Definition
 * Uses indexed data for fast lookup with LSP fallback
 */
export async function findDefinitions(
  wordText: string,
  beforeWord: string,
  afterWord: string,
  projectPath: string,
  filePath: string,
  content: string,
  line: number,
  column: number,
): Promise<DefinitionItem[]> {
  try {
    const results = await GoToDefinition(
      filePath,
      content,
      line,
      column,
      wordText,
      beforeWord,
      afterWord,
    );

    if (results && results.length > 0) {
      return results.map((r) => ({
        path: r.path,
        line: r.line,
        context: r.context,
        displayPath: r.displayPath,
      }));
    }
  } catch (error) {
    console.error("GoToDefinition error:", error);
  }

  return [];
}

/**
 * Check if word at position likely has a definition
 * Used for hover highlighting - works for all languages via LSP + framework patterns
 */
export function checkIfHasDefinition(
  wordText: string,
  beforeWord: string,
  afterWord: string,
): boolean {
  // =============== PHP / Laravel ===============
  
  // PHP use statements: use App\Models\User
  if (beforeWord.match(/\buse\s+[\w\\]*\\?$/)) {
    return true;
  }

  // Middleware: ->middleware("auth"), ->middleware(["auth", "verified"])
  if (
    beforeWord.match(/middleware\s*\(\s*\[?\s*['"]/) ||
    beforeWord.match(/['"]\s*,\s*['"]$/)
  ) {
    if (afterWord.match(/^['"]/)) {
      return true;
    }
  }

  // Route name definition: ->name("profile.edit")
  if (beforeWord.match(/->name\s*\(\s*['"]/) && afterWord.match(/^['"]/)) {
    return true;
  }

  // Route: route('name')
  if (beforeWord.match(/route\(['"]/) && afterWord.match(/^['"]/)) {
    return true;
  }

  // View: view('name'), @extends('name'), @include('name'), @component('name')
  if (
    beforeWord.match(
      /(?:view|@extends|@include|@includeIf|@includeWhen|@includeUnless|@includeFirst|@component|@componentFirst)\s*\(\s*['"]/,
    ) &&
    afterWord.match(/^['"]/)
  ) {
    return true;
  }

  // Config: config('key')
  if (beforeWord.match(/config\(['"]/) && afterWord.match(/^['"]/)) {
    return true;
  }

  // Static calls: User::find(), Cache::get() (but not ::class)
  if (afterWord.match(/^::/) && !afterWord.match(/^::class/)) {
    return true;
  }

  // Class reference: User::class, UserController::class
  if (afterWord.match(/^::class/)) {
    return true;
  }

  // Controller action: [UserController::class, 'index']
  if (
    beforeWord.match(/\[\w+Controller::class,\s*['"]/) &&
    afterWord.match(/^['"]\s*\]/)
  ) {
    return true;
  }

  // Model relationships: hasMany(Model::class), belongsTo(Model::class)
  if (
    beforeWord.match(
      /\$this->(hasMany|hasOne|belongsTo|belongsToMany|morphTo|morphMany|morphToMany)\s*\(/,
    ) &&
    afterWord.match(/^::class/)
  ) {
    return true;
  }

  // Blade components: <x-component-name, </x-component-name>
  const combined = beforeWord + wordText + afterWord;
  const componentMatch = combined.match(/<\/?x-([a-zA-Z0-9._-]+)/);
  if (componentMatch && !componentMatch[1].startsWith("slot")) {
    if (beforeWord.match(/<\/?x-/) || beforeWord.match(/<\/?x-[a-zA-Z0-9._-]*$/)) {
      return true;
    }
  }

  // =============== Python / Django ===============
  
  // Django imports: from django.views import View
  if (beforeWord.match(/\bfrom\s+[\w.]+\s+import\s*$/)) {
    return true;
  }
  if (beforeWord.match(/\bimport\s+[\w.]*$/)) {
    return true;
  }
  
  // Django URLs: path('name/', views.func), reverse('name')
  if (beforeWord.match(/reverse\(['"]/) && afterWord.match(/^['"]/)) {
    return true;
  }
  
  // Django templates: {% include 'template.html' %}, {% extends 'base.html' %}
  if (beforeWord.match(/{%\s*(include|extends)\s+['"]/) && afterWord.match(/^['"]/)) {
    return true;
  }
  
  // Django model fields: ForeignKey(Model), models.ForeignKey('Model')
  if (beforeWord.match(/ForeignKey\s*\(\s*['"]?/) && (afterWord.match(/^['"]?\s*[,)]/) || afterWord.match(/^['"]/))) {
    return true;
  }

  // =============== JavaScript / TypeScript / React / Vue ===============
  
  // ES imports: import X from 'module', import { X } from 'module'
  if (beforeWord.match(/\bimport\s+.*\bfrom\s+['"]/) && afterWord.match(/^['"]/)) {
    return true;
  }
  if (beforeWord.match(/\bimport\s*\(\s*['"]/) && afterWord.match(/^['"]/)) {
    return true;
  }
  if (beforeWord.match(/\brequire\s*\(\s*['"]/) && afterWord.match(/^['"]/)) {
    return true;
  }
  
  // React/Vue components: <Component, </Component
  if (beforeWord.match(/<\/?$/) && wordText.match(/^[A-Z]/)) {
    return true;
  }
  
  // Object property access: obj.method()
  if (beforeWord.match(/\.\s*$/) && afterWord.match(/^\s*\(/)) {
    return true;
  }

  // =============== Ruby / Rails ===============
  
  // Rails routes: redirect_to root_path, link_to 'name', path
  if (beforeWord.match(/(?:redirect_to|link_to|url_for)\s+/) && wordText.match(/_path$|_url$/)) {
    return true;
  }
  
  // Rails render: render 'partial', render partial: 'name'
  if (beforeWord.match(/render\s+['":]*/) && afterWord.match(/^['"]/)) {
    return true;
  }
  
  // Ruby require/require_relative
  if (beforeWord.match(/require(?:_relative)?\s+['"]/) && afterWord.match(/^['"]/)) {
    return true;
  }

  // =============== Go ===============
  
  // Go imports: import "package"
  if (beforeWord.match(/import\s+["']/) && afterWord.match(/^["']/)) {
    return true;
  }
  
  // Go package.Function calls
  if (beforeWord.match(/\w+\.\s*$/) && afterWord.match(/^\s*\(/)) {
    return true;
  }

  // =============== Universal: Any identifier likely has definition ===============
  
  // Function/method calls
  if (afterWord.match(/^\s*\(/)) {
    return true;
  }
  
  // Type annotations (TypeScript, Python, Go, etc.)
  if (beforeWord.match(/:\s*$/) && wordText.match(/^[A-Z]/)) {
    return true;
  }
  
  // Class instantiation: new ClassName
  if (beforeWord.match(/new\s+$/)) {
    return true;
  }

  return false;
}

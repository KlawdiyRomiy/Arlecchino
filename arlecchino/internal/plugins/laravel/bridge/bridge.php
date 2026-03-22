<?php

ini_set('display_errors', 'stderr');
error_reporting(E_ALL);

class LaravelBridge
{
    private $projectPath;
    private $app = null;
    private $laravelBooted = false;

    public function __construct($projectPath = null)
    {
        $this->projectPath = $projectPath ?: getcwd();
        chdir($this->projectPath);
    }
    
    private function bootLaravelIfNeeded()
    {
        if ($this->laravelBooted) {
            return;
        }
        
        ob_start();
        
        try {
            if (!file_exists("vendor/autoload.php")) {
                throw new Exception("Laravel vendor/autoload.php not found. Run 'composer install'");
            }
            
            if (!file_exists("bootstrap/app.php")) {
                throw new Exception("Not a Laravel project - bootstrap/app.php not found");
            }
            
            require_once "vendor/autoload.php";
            
            $this->app = require_once "bootstrap/app.php";
            $kernel = $this->app->make(\Illuminate\Contracts\Console\Kernel::class);
            $kernel->bootstrap();
            
            $this->laravelBooted = true;
        } finally {
            if (ob_get_length()) ob_clean();
        }
    }

    public function run()
    {
        ob_start();

        while (true) {
            $input = fgets(STDIN);
            if ($input === false) {
                break;
            }
            $input = trim($input);
            if (empty($input)) {
                continue;
            }
            
            if (ob_get_length()) ob_clean();

            try {
                $request = json_decode($input, true, 512, JSON_THROW_ON_ERROR);
                $response = $this->handleRequest($request);

                if (ob_get_length()) ob_clean();
                echo json_encode($response) . "\n";
                flush();
            } catch (Throwable $e) {
                if (ob_get_length()) ob_clean();                
                $errorResponse = [
                    "id" => $request["id"] ?? null,
                    "result" => null,
                    "error" => $e->getMessage(),
                    "success" => false,
                ];
                echo json_encode($errorResponse) . "\n";
                flush();
            }
        }
    }

    private function handleRequest($request)
    {
        $action = $request["action"] ?? null;
        $params = $request["params"] ?? [];
        $id = $request["id"] ?? null;

        if (!$action) {
            throw new Exception("Action is required");
        }

        $result = null;
        $success = false;
        $error = null;

        try {
            switch ($action) {
                case "route.list":
                    $result = $this->getRouteList($params);
                    $success = true;
                    break;
                case "model.analyze":
                    $result = $this->analyzeModels($params);
                    $success = true;
                    break;
                case "query.execute":
                    $result = $this->executeQuery($params);
                    $success = true;
                    break;
                case "artisan.run":
                    $result = $this->runArtisanCommand($params);
                    $success = true;
                    break;
                case "middleware.list":
                    $result = $this->getMiddlewareList($params);
                    $success = true;
                    break;
                case "ide.inspect":
                    $result = $this->inspectProject($params);
                    $success = true;
                    break;
                default:
                    throw new Exception("Unknown action: $action");
            }
        } catch (Throwable $e) {
            $error = $e->getMessage();
        }

        return [
            "id" => $id,
            "result" => $result,
            "error" => $error,
            "success" => $success,
        ];
    }

    private function getRouteList($params)
    {
        $this->bootLaravelIfNeeded();
        
        $filter = $params["filter"] ?? null;
        
        try {
            $routes = collect(\Route::getRoutes())->map(function($route) {
                return [
                    'method' => implode('|', $route->methods()),
                    'uri' => $route->uri(),
                    'name' => $route->getName(),
                    'action' => $route->getActionName(),
                    'middleware' => $route->gatherMiddleware(),
                ];
            });
            
            if ($filter) {
                $routes = $routes->filter(function($route) use ($filter) {
                    return stripos($route['uri'], $filter) !== false 
                        || stripos($route['name'] ?? '', $filter) !== false;
                });
            }
            
            return [
                'routes' => $routes->values()->toArray(),
                'total' => $routes->count(),
            ];
        } catch (Exception $e) {
            throw new Exception("Failed to get routes: " . $e->getMessage());
        }
    }

    private function analyzeModels($params)
    {
        $model = $params["model"] ?? null;
        $includeRelationships = $params["includeRelationships"] ?? true;
        $includeProperties = $params["includeProperties"] ?? true;

        if ($model) {
            return $this->analyzeSingleModel(
                $model,
                $includeRelationships,
                $includeProperties,
            );
        } else {
            return $this->analyzeAllModels(
                $includeRelationships,
                $includeProperties,
            );
        }
    }

    private function analyzeSingleModel(
        $model,
        $includeRelationships,
        $includeProperties,
    ) {
        if (!class_exists($model)) {
            throw new Exception("Model class {$model} does not exist");
        }

        try {
            $reflection = new ReflectionClass($model);
            $modelInstance = $reflection->newInstanceWithoutConstructor();

            $result = [
                "name" => $reflection->getName(),
                "namespace" => $reflection->getNamespaceName(),
                "filename" => $reflection->getFileName(),
                "properties" => [],
                "methods" => [],
                "relationships" => [],
            ];

            if ($includeProperties) {
                $properties = [];
                foreach (
                    $reflection->getProperties(
                        ReflectionProperty::IS_PUBLIC |
                            ReflectionProperty::IS_PROTECTED |
                            ReflectionProperty::IS_PRIVATE,
                    )
                    as $property
                ) {
                    $properties[] = [
                        "name" => $property->getName(),
                        "visibility" => $property->isPublic()
                            ? "public"
                            : ($property->isProtected()
                                ? "protected"
                                : "private"),
                        "doc_comment" => $property->getDocComment(),
                    ];
                }
                $result["properties"] = $properties;
            }

            if ($includeRelationships) {
                $relationships = [];
                $methods = get_class_methods($modelInstance);
                foreach ($methods as $method) {
                    if (method_exists($modelInstance, $method)) {
                        try {
                            $reflectionMethod = new ReflectionMethod(
                                $modelInstance,
                                $method,
                            );
                            $docComment = $reflectionMethod->getDocComment();

                            if (
                                $reflectionMethod->getNumberOfParameters() === 0
                            ) {
                                $returnType = $reflectionMethod->getReturnType();
                                if ($returnType) {
                                    $typeName = $returnType->getName();
                                    if (
                                        strpos(
                                            $typeName,
                                            "Illuminate\\Database\\Eloquent\\Relations\\",
                                        ) === 0
                                    ) {
                                        $relationships[] = [
                                            "name" => $method,
                                            "type" => $typeName,
                                            "related_model" => $this->getRelatedModelFromMethod(
                                                $modelInstance,
                                                $method,
                                            ),
                                        ];
                                    }
                                }
                            }
                        } catch (Exception $e) {
                        }
                    }
                }
                $result["relationships"] = $relationships;
            }

            return $result;
        } catch (Exception $e) {
            throw new Exception(
                "Error analyzing model {$model}: " . $e->getMessage(),
            );
        }
    }

    private function getRelatedModelFromMethod($modelInstance, $methodName)
    {
        try {
            $relation = $modelInstance->$methodName();
            if (method_exists($relation, "getRelated")) {
                $relatedClass = get_class($relation->getRelated());
                return $relatedClass;
            }
        } catch (Exception $e) {
        }
        return null;
    }

    private function analyzeAllModels($includeRelationships, $includeProperties)
    {
        $models = [];

        $modelPaths = ["app/Models", "app"];

        foreach ($modelPaths as $path) {
            if (is_dir($path)) {
                $iterator = new RecursiveIteratorIterator(
                    new RecursiveDirectoryIterator($path),
                );

                foreach ($iterator as $file) {
                    if ($file->isFile() && $file->getExtension() === "php") {
                        $content = file_get_contents($file->getPathname());
                        if (
                            preg_match(
                                "/namespace\s+([^\s;]+)/",
                                $content,
                                $namespaceMatches,
                            ) &&
                            preg_match(
                                "/class\s+(\w+)/",
                                $content,
                                $classMatches,
                            )
                        ) {
                            $namespace = $namespaceMatches[1];
                            $className = $classMatches[1];
                            $fullClassName = $namespace . "\\" . $className;

                            if (class_exists($fullClassName)) {
                                $reflection = new ReflectionClass(
                                    $fullClassName,
                                );
                                if (
                                    $reflection->isSubclassOf(
                                        "Illuminate\\Database\\Eloquent\\Model",
                                    )
                                ) {
                                    try {
                                        $modelData = $this->analyzeSingleModel(
                                            $fullClassName,
                                            $includeRelationships,
                                            $includeProperties,
                                        );
                                        $models[] = $modelData;
                                    } catch (Exception $e) {
                                        $models[] = [
                                            "name" => $fullClassName,
                                            "error" => $e->getMessage(),
                                        ];
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        return $models;
    }

    private function executeQuery($params)
    {
        $query = $params["query"] ?? null;
        $bindings = $params["bindings"] ?? [];

        if (!$query) {
            throw new Exception("Query is required for query.execute action");
        }

        $this->bootLaravelIfNeeded();

        try {
            $db = $this->app->make("db");
            $connection = $db->connection();

            $results = $connection->select($connection->raw($query), $bindings);

            return [
                "query" => $query,
                "bindings" => $bindings,
                "results" => $results,
                "count" => count($results),
            ];
        } catch (Exception $e) {
            throw new Exception("Query execution error: " . $e->getMessage());
        }
    }

    private function getMiddlewareList($params)
    {
        $this->bootLaravelIfNeeded();
        
        try {
            $router = $this->app->make('router');
            
            $globalMiddleware = [];
            if (method_exists($router, 'getMiddleware')) {
                $globalMiddleware = $router->getMiddleware();
            }
            
            $routeMiddleware = $router->getMiddlewareGroups();
            $middlewareAliases = method_exists($router, 'getMiddlewareAliases') 
                ? $router->getMiddlewareAliases() 
                : [];
            
            return [
                'global' => array_keys($globalMiddleware),
                'groups' => empty($routeMiddleware) ? new \stdClass() : array_map(function($group) {
                    return is_array($group) ? $group : [$group];
                }, $routeMiddleware),
                'aliases' => empty($middlewareAliases) ? new \stdClass() : $middlewareAliases,
            ];
        } catch (Exception $e) {
            throw new Exception("Failed to get middleware: " . $e->getMessage());
        }
    }

    private function runArtisanCommand($params)
    {
        $command = $params["command"] ?? null;
        $arguments = $params["arguments"] ?? [];

        if (!$command) {
            throw new Exception("Command is required for artisan.run action");
        }

        $fullCommand = "php artisan {$command}";

        foreach ($arguments as $key => $value) {
            if (is_numeric($key)) {
                $fullCommand .= " " . escapeshellarg($value);
            } else {
                if (is_bool($value)) {
                    if ($value) {
                        $fullCommand .= " --{$key}";
                    }
                } else {
                    $fullCommand .= " --{$key}=" . escapeshellarg($value);
                }
            }
        }

        $output = shell_exec($fullCommand);

        if ($output === null) {
            throw new Exception("Failed to execute artisan command");
        }

        return [
            "command" => $fullCommand,
            "output" => trim($output),
        ];
    }

    private function inspectProject($params)
    {
        $this->bootLaravelIfNeeded();

        return [
            'routes' => $this->getRouteList([])['routes'],
            'models' => $this->analyzeAllModels(true, true),
            'bindings' => $this->getContainerBindings(),
            'views' => $this->getViewComponents(),
            'middleware' => $this->getMiddlewareList([])
        ];
    }

    private function getContainerBindings()
    {
        $bindings = $this->app->getBindings();
        $result = [];
        
        foreach ($bindings as $abstract => $concrete) {
            $concreteType = 'unknown';
            if (isset($concrete['concrete'])) {
                if (is_callable($concrete['concrete'])) {
                    $concreteType = 'closure';
                } elseif (is_string($concrete['concrete'])) {
                    $concreteType = $concrete['concrete'];
                }
            }
            
            $result[] = [
                'abstract' => $abstract,
                'concrete' => $concreteType,
                'shared' => $concrete['shared'] ?? false,
            ];
        }
        
        return $result;
    }

    private function getViewComponents()
    {
        $components = [];
        
        // Scan app/View/Components
        $componentPath = 'app/View/Components';
        if (is_dir($componentPath)) {
            $iterator = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($componentPath)
            );
            
            foreach ($iterator as $file) {
                if ($file->isFile() && $file->getExtension() === 'php') {
                    $className = $this->getClassNameFromFile($file->getPathname());
                    if ($className) {
                        $components[] = [
                            'name' => $className,
                            'path' => $file->getPathname(),
                            'type' => 'class',
                        ];
                    }
                }
            }
        }
        
        // Get Blade aliases if possible
        try {
            $blade = $this->app->make('blade.compiler');
            $aliases = $blade->getClassComponentAliases();
            foreach ($aliases as $alias => $class) {
                $components[] = [
                    'name' => $alias,
                    'class' => $class,
                    'type' => 'alias',
                ];
            }
        } catch (Exception $e) {
            // Ignore if blade compiler not available
        }
        
        return $components;
    }

    private function getClassNameFromFile($filePath)
    {
        $content = file_get_contents($filePath);
        if (preg_match('/namespace\s+([^\s;]+)/', $content, $matches)) {
            $namespace = $matches[1];
            if (preg_match('/class\s+(\w+)/', $content, $classMatches)) {
                return $namespace . '\\' . $classMatches[1];
            }
        }
        return null;
    }
}

// Get project path from command line argument or use current directory
$projectPath = $argc > 1 ? $argv[1] : getcwd();
$bridge = new LaravelBridge($projectPath);
$bridge->run();

package brain

import (
	"fmt"
	"strings"

	"arlecchino/internal/indexer/core"
)

type FacadeMethod struct {
	Name       string
	Params     string
	ReturnType string
	Doc        string
}

var laravelFacadeMethods = map[string][]FacadeMethod{
	"route": {
		{Name: "get", Params: "string $uri, $action", ReturnType: "Route"},
		{Name: "post", Params: "string $uri, $action", ReturnType: "Route"},
		{Name: "put", Params: "string $uri, $action", ReturnType: "Route"},
		{Name: "patch", Params: "string $uri, $action", ReturnType: "Route"},
		{Name: "delete", Params: "string $uri, $action", ReturnType: "Route"},
		{Name: "options", Params: "string $uri, $action", ReturnType: "Route"},
		{Name: "any", Params: "string $uri, $action", ReturnType: "Route"},
		{Name: "match", Params: "array $methods, string $uri, $action", ReturnType: "Route"},
		{Name: "redirect", Params: "string $uri, string $destination, int $status = 302", ReturnType: "Route"},
		{Name: "permanentRedirect", Params: "string $uri, string $destination", ReturnType: "Route"},
		{Name: "view", Params: "string $uri, string $view, array $data = []", ReturnType: "Route"},
		{Name: "resource", Params: "string $name, string $controller, array $options = []", ReturnType: "PendingResourceRegistration"},
		{Name: "apiResource", Params: "string $name, string $controller, array $options = []", ReturnType: "PendingResourceRegistration"},
		{Name: "singleton", Params: "string $name, string $controller, array $options = []", ReturnType: "PendingSingletonResourceRegistration"},
		{Name: "group", Params: "array $attributes, Closure $routes", ReturnType: "Router"},
		{Name: "middleware", Params: "array|string $middleware", ReturnType: "RouteRegistrar"},
		{Name: "prefix", Params: "string $prefix", ReturnType: "RouteRegistrar"},
		{Name: "name", Params: "string $name", ReturnType: "RouteRegistrar"},
		{Name: "namespace", Params: "string $namespace", ReturnType: "RouteRegistrar"},
		{Name: "domain", Params: "string $domain", ReturnType: "RouteRegistrar"},
		{Name: "where", Params: "array|string $name, string $expression = null", ReturnType: "RouteRegistrar"},
		{Name: "controller", Params: "string $controller", ReturnType: "RouteRegistrar"},
		{Name: "fallback", Params: "$action", ReturnType: "Route"},
		{Name: "current", Params: "", ReturnType: "Route|null"},
		{Name: "currentRouteName", Params: "", ReturnType: "string|null"},
		{Name: "currentRouteAction", Params: "", ReturnType: "string|null"},
		{Name: "has", Params: "string|array $name", ReturnType: "bool"},
		{Name: "is", Params: "...$patterns", ReturnType: "bool"},
	},
	"db": {
		{Name: "connection", Params: "string $name = null", ReturnType: "Connection"},
		{Name: "table", Params: "string $table, string $as = null", ReturnType: "Builder"},
		{Name: "raw", Params: "mixed $value", ReturnType: "Expression"},
		{Name: "select", Params: "string $query, array $bindings = []", ReturnType: "array"},
		{Name: "insert", Params: "string $query, array $bindings = []", ReturnType: "bool"},
		{Name: "update", Params: "string $query, array $bindings = []", ReturnType: "int"},
		{Name: "delete", Params: "string $query, array $bindings = []", ReturnType: "int"},
		{Name: "statement", Params: "string $query, array $bindings = []", ReturnType: "bool"},
		{Name: "unprepared", Params: "string $query", ReturnType: "bool"},
		{Name: "transaction", Params: "Closure $callback, int $attempts = 1", ReturnType: "mixed"},
		{Name: "beginTransaction", Params: "", ReturnType: "void"},
		{Name: "commit", Params: "", ReturnType: "void"},
		{Name: "rollBack", Params: "int $toLevel = null", ReturnType: "void"},
		{Name: "transactionLevel", Params: "", ReturnType: "int"},
		{Name: "listen", Params: "Closure $callback", ReturnType: "void"},
	},
	"cache": {
		{Name: "store", Params: "string $name = null", ReturnType: "Repository"},
		{Name: "driver", Params: "string $driver = null", ReturnType: "Repository"},
		{Name: "get", Params: "string $key, $default = null", ReturnType: "mixed"},
		{Name: "many", Params: "array $keys", ReturnType: "array"},
		{Name: "put", Params: "string $key, $value, $ttl = null", ReturnType: "bool"},
		{Name: "putMany", Params: "array $values, $ttl = null", ReturnType: "bool"},
		{Name: "add", Params: "string $key, $value, $ttl = null", ReturnType: "bool"},
		{Name: "increment", Params: "string $key, int $value = 1", ReturnType: "int|bool"},
		{Name: "decrement", Params: "string $key, int $value = 1", ReturnType: "int|bool"},
		{Name: "forever", Params: "string $key, $value", ReturnType: "bool"},
		{Name: "forget", Params: "string $key", ReturnType: "bool"},
		{Name: "flush", Params: "", ReturnType: "bool"},
		{Name: "has", Params: "string $key", ReturnType: "bool"},
		{Name: "missing", Params: "string $key", ReturnType: "bool"},
		{Name: "pull", Params: "string $key, $default = null", ReturnType: "mixed"},
		{Name: "remember", Params: "string $key, $ttl, Closure $callback", ReturnType: "mixed"},
		{Name: "rememberForever", Params: "string $key, Closure $callback", ReturnType: "mixed"},
		{Name: "sear", Params: "string $key, Closure $callback", ReturnType: "mixed"},
		{Name: "tags", Params: "array|string $names", ReturnType: "TaggedCache"},
		{Name: "lock", Params: "string $name, int $seconds = 0, string $owner = null", ReturnType: "Lock"},
		{Name: "restoreLock", Params: "string $name, string $owner", ReturnType: "Lock"},
	},
	"config": {
		{Name: "get", Params: "string $key, $default = null", ReturnType: "mixed"},
		{Name: "set", Params: "array|string $key, $value = null", ReturnType: "void"},
		{Name: "has", Params: "string $key", ReturnType: "bool"},
		{Name: "all", Params: "", ReturnType: "array"},
		{Name: "prepend", Params: "string $key, $value", ReturnType: "void"},
		{Name: "push", Params: "string $key, $value", ReturnType: "void"},
	},
	"auth": {
		{Name: "guard", Params: "string $name = null", ReturnType: "Guard"},
		{Name: "user", Params: "", ReturnType: "Authenticatable|null"},
		{Name: "id", Params: "", ReturnType: "int|string|null"},
		{Name: "check", Params: "", ReturnType: "bool"},
		{Name: "guest", Params: "", ReturnType: "bool"},
		{Name: "attempt", Params: "array $credentials = [], bool $remember = false", ReturnType: "bool"},
		{Name: "once", Params: "array $credentials = []", ReturnType: "bool"},
		{Name: "login", Params: "Authenticatable $user, bool $remember = false", ReturnType: "void"},
		{Name: "loginUsingId", Params: "mixed $id, bool $remember = false", ReturnType: "Authenticatable|false"},
		{Name: "onceUsingId", Params: "mixed $id", ReturnType: "Authenticatable|false"},
		{Name: "logout", Params: "", ReturnType: "void"},
		{Name: "logoutCurrentDevice", Params: "", ReturnType: "void"},
		{Name: "logoutOtherDevices", Params: "string $password", ReturnType: "Authenticatable|null"},
		{Name: "validate", Params: "array $credentials = []", ReturnType: "bool"},
		{Name: "viaRemember", Params: "", ReturnType: "bool"},
		{Name: "setUser", Params: "Authenticatable $user", ReturnType: "void"},
	},
	"session": {
		{Name: "get", Params: "string $key, $default = null", ReturnType: "mixed"},
		{Name: "put", Params: "string|array $key, $value = null", ReturnType: "void"},
		{Name: "push", Params: "string $key, $value", ReturnType: "void"},
		{Name: "pull", Params: "string $key, $default = null", ReturnType: "mixed"},
		{Name: "has", Params: "string|array $key", ReturnType: "bool"},
		{Name: "exists", Params: "string|array $key", ReturnType: "bool"},
		{Name: "missing", Params: "string|array $key", ReturnType: "bool"},
		{Name: "all", Params: "", ReturnType: "array"},
		{Name: "only", Params: "array $keys", ReturnType: "array"},
		{Name: "forget", Params: "string|array $keys", ReturnType: "void"},
		{Name: "flush", Params: "", ReturnType: "void"},
		{Name: "flash", Params: "string $key, $value = true", ReturnType: "void"},
		{Name: "now", Params: "string $key, $value", ReturnType: "void"},
		{Name: "reflash", Params: "", ReturnType: "void"},
		{Name: "keep", Params: "string|array $keys = null", ReturnType: "void"},
		{Name: "token", Params: "", ReturnType: "string"},
		{Name: "regenerateToken", Params: "", ReturnType: "void"},
		{Name: "regenerate", Params: "bool $destroy = false", ReturnType: "bool"},
		{Name: "invalidate", Params: "", ReturnType: "bool"},
		{Name: "getId", Params: "", ReturnType: "string"},
		{Name: "setId", Params: "string $id", ReturnType: "void"},
		{Name: "previousUrl", Params: "", ReturnType: "string|null"},
	},
	"request": {
		{Name: "input", Params: "string $key = null, $default = null", ReturnType: "mixed"},
		{Name: "query", Params: "string $key = null, $default = null", ReturnType: "mixed"},
		{Name: "post", Params: "string $key = null, $default = null", ReturnType: "mixed"},
		{Name: "all", Params: "array $keys = null", ReturnType: "array"},
		{Name: "only", Params: "array|mixed $keys", ReturnType: "array"},
		{Name: "except", Params: "array|mixed $keys", ReturnType: "array"},
		{Name: "has", Params: "string|array $key", ReturnType: "bool"},
		{Name: "hasAny", Params: "string|array $keys", ReturnType: "bool"},
		{Name: "filled", Params: "string|array $key", ReturnType: "bool"},
		{Name: "missing", Params: "string|array $key", ReturnType: "bool"},
		{Name: "whenHas", Params: "string $key, callable $callback, callable $default = null", ReturnType: "mixed"},
		{Name: "whenFilled", Params: "string $key, callable $callback, callable $default = null", ReturnType: "mixed"},
		{Name: "file", Params: "string $key = null, $default = null", ReturnType: "UploadedFile|array|null"},
		{Name: "hasFile", Params: "string $key", ReturnType: "bool"},
		{Name: "boolean", Params: "string $key = null, bool $default = false", ReturnType: "bool"},
		{Name: "integer", Params: "string $key, int $default = 0", ReturnType: "int"},
		{Name: "float", Params: "string $key, float $default = 0.0", ReturnType: "float"},
		{Name: "string", Params: "string $key, string $default = ''", ReturnType: "Stringable"},
		{Name: "date", Params: "string $key, string $format = null, string $tz = null", ReturnType: "Carbon|null"},
		{Name: "enum", Params: "string $key, string $enumClass", ReturnType: "BackedEnum|null"},
		{Name: "collect", Params: "string $key = null", ReturnType: "Collection"},
		{Name: "validate", Params: "array $rules, array $messages = [], array $attributes = []", ReturnType: "array"},
		{Name: "validateWithBag", Params: "string $errorBag, array $rules, array $messages = [], array $attributes = []", ReturnType: "array"},
		{Name: "is", Params: "...$patterns", ReturnType: "bool"},
		{Name: "routeIs", Params: "...$patterns", ReturnType: "bool"},
		{Name: "fullUrl", Params: "", ReturnType: "string"},
		{Name: "fullUrlWithQuery", Params: "array $query", ReturnType: "string"},
		{Name: "url", Params: "", ReturnType: "string"},
		{Name: "path", Params: "", ReturnType: "string"},
		{Name: "segment", Params: "int $index, string $default = null", ReturnType: "string|null"},
		{Name: "segments", Params: "", ReturnType: "array"},
		{Name: "method", Params: "", ReturnType: "string"},
		{Name: "isMethod", Params: "string $method", ReturnType: "bool"},
		{Name: "header", Params: "string $key = null, $default = null", ReturnType: "string|array|null"},
		{Name: "bearerToken", Params: "", ReturnType: "string|null"},
		{Name: "ip", Params: "", ReturnType: "string|null"},
		{Name: "ips", Params: "", ReturnType: "array"},
		{Name: "userAgent", Params: "", ReturnType: "string|null"},
		{Name: "user", Params: "string $guard = null", ReturnType: "Authenticatable|null"},
		{Name: "cookie", Params: "string $key = null, $default = null", ReturnType: "string|array|null"},
		{Name: "ajax", Params: "", ReturnType: "bool"},
		{Name: "pjax", Params: "", ReturnType: "bool"},
		{Name: "secure", Params: "", ReturnType: "bool"},
		{Name: "expectsJson", Params: "", ReturnType: "bool"},
		{Name: "wantsJson", Params: "", ReturnType: "bool"},
		{Name: "accepts", Params: "string|array $contentTypes", ReturnType: "bool"},
		{Name: "prefers", Params: "string|array $contentTypes", ReturnType: "string|null"},
	},
	"response": {
		{Name: "make", Params: "mixed $content = '', int $status = 200, array $headers = []", ReturnType: "Response"},
		{Name: "noContent", Params: "int $status = 204, array $headers = []", ReturnType: "Response"},
		{Name: "view", Params: "string $view, array $data = [], int $status = 200, array $headers = []", ReturnType: "Response"},
		{Name: "json", Params: "mixed $data = [], int $status = 200, array $headers = [], int $options = 0", ReturnType: "JsonResponse"},
		{Name: "jsonp", Params: "string $callback, mixed $data = [], int $status = 200, array $headers = [], int $options = 0", ReturnType: "JsonResponse"},
		{Name: "stream", Params: "callable $callback, int $status = 200, array $headers = []", ReturnType: "StreamedResponse"},
		{Name: "streamDownload", Params: "callable $callback, string $name = null, array $headers = [], string $disposition = 'attachment'", ReturnType: "StreamedResponse"},
		{Name: "download", Params: "string $file, string $name = null, array $headers = [], string $disposition = 'attachment'", ReturnType: "BinaryFileResponse"},
		{Name: "file", Params: "string $file, array $headers = []", ReturnType: "BinaryFileResponse"},
		{Name: "redirectTo", Params: "string $path, int $status = 302, array $headers = [], bool $secure = null", ReturnType: "RedirectResponse"},
		{Name: "redirectToRoute", Params: "string $route, array $parameters = [], int $status = 302, array $headers = []", ReturnType: "RedirectResponse"},
		{Name: "redirectToAction", Params: "string|array $action, array $parameters = [], int $status = 302, array $headers = []", ReturnType: "RedirectResponse"},
		{Name: "redirectGuest", Params: "string $path, int $status = 302, array $headers = [], bool $secure = null", ReturnType: "RedirectResponse"},
		{Name: "redirectToIntended", Params: "string $default = '/', int $status = 302, array $headers = [], bool $secure = null", ReturnType: "RedirectResponse"},
	},
	"log": {
		{Name: "emergency", Params: "string $message, array $context = []", ReturnType: "void"},
		{Name: "alert", Params: "string $message, array $context = []", ReturnType: "void"},
		{Name: "critical", Params: "string $message, array $context = []", ReturnType: "void"},
		{Name: "error", Params: "string $message, array $context = []", ReturnType: "void"},
		{Name: "warning", Params: "string $message, array $context = []", ReturnType: "void"},
		{Name: "notice", Params: "string $message, array $context = []", ReturnType: "void"},
		{Name: "info", Params: "string $message, array $context = []", ReturnType: "void"},
		{Name: "debug", Params: "string $message, array $context = []", ReturnType: "void"},
		{Name: "log", Params: "mixed $level, string $message, array $context = []", ReturnType: "void"},
		{Name: "channel", Params: "string $channel = null", ReturnType: "LoggerInterface"},
		{Name: "stack", Params: "array $channels, string $channel = null", ReturnType: "LoggerInterface"},
		{Name: "driver", Params: "string $driver = null", ReturnType: "LoggerInterface"},
	},
	"view": {
		{Name: "make", Params: "string $view, array $data = [], array $mergeData = []", ReturnType: "View"},
		{Name: "first", Params: "array $views, array $data = [], array $mergeData = []", ReturnType: "View"},
		{Name: "renderWhen", Params: "bool $condition, string $view, array $data = [], array $mergeData = []", ReturnType: "string"},
		{Name: "renderUnless", Params: "bool $condition, string $view, array $data = [], array $mergeData = []", ReturnType: "string"},
		{Name: "exists", Params: "string $view", ReturnType: "bool"},
		{Name: "share", Params: "array|string $key, $value = null", ReturnType: "mixed"},
		{Name: "composer", Params: "array|string $views, Closure|string $callback", ReturnType: "array"},
		{Name: "creator", Params: "array|string $views, Closure|string $callback", ReturnType: "array"},
		{Name: "addNamespace", Params: "string $namespace, string|array $hints", ReturnType: "Factory"},
		{Name: "replaceNamespace", Params: "string $namespace, string|array $hints", ReturnType: "Factory"},
	},
	"validator": {
		{Name: "make", Params: "array $data, array $rules, array $messages = [], array $attributes = []", ReturnType: "Validator"},
		{Name: "validate", Params: "array $data, array $rules, array $messages = [], array $attributes = []", ReturnType: "array"},
		{Name: "extend", Params: "string $rule, Closure|string $extension, string $message = null", ReturnType: "void"},
		{Name: "extendImplicit", Params: "string $rule, Closure|string $extension, string $message = null", ReturnType: "void"},
		{Name: "extendDependent", Params: "string $rule, Closure|string $extension, string $message = null", ReturnType: "void"},
		{Name: "replacer", Params: "string $rule, Closure|string $replacer", ReturnType: "void"},
		{Name: "includeUnvalidatedArrayKeys", Params: "", ReturnType: "void"},
		{Name: "excludeUnvalidatedArrayKeys", Params: "", ReturnType: "void"},
	},
	"event": {
		{Name: "dispatch", Params: "string|object $event, mixed $payload = [], bool $halt = false", ReturnType: "array|null"},
		{Name: "listen", Params: "string|array $events, Closure|string|array $listener = null", ReturnType: "void"},
		{Name: "subscribe", Params: "object|string $subscriber", ReturnType: "void"},
		{Name: "push", Params: "string $event, array $payload = []", ReturnType: "void"},
		{Name: "flush", Params: "string $event", ReturnType: "void"},
		{Name: "forget", Params: "string $event", ReturnType: "void"},
		{Name: "forgetPushed", Params: "", ReturnType: "void"},
		{Name: "until", Params: "string|object $event, mixed $payload = []", ReturnType: "mixed"},
		{Name: "hasListeners", Params: "string $eventName", ReturnType: "bool"},
	},
	"storage": {
		{Name: "disk", Params: "string $name = null", ReturnType: "Filesystem"},
		{Name: "drive", Params: "string $name = null", ReturnType: "Filesystem"},
		{Name: "cloud", Params: "", ReturnType: "Filesystem"},
		{Name: "build", Params: "array $config", ReturnType: "Filesystem"},
		{Name: "createLocalDriver", Params: "array $config", ReturnType: "Filesystem"},
		{Name: "createFtpDriver", Params: "array $config", ReturnType: "Filesystem"},
		{Name: "createSftpDriver", Params: "array $config", ReturnType: "Filesystem"},
		{Name: "createS3Driver", Params: "array $config", ReturnType: "Cloud"},
		{Name: "get", Params: "string $path", ReturnType: "string|null"},
		{Name: "put", Params: "string $path, $contents, $options = []", ReturnType: "bool"},
		{Name: "putFile", Params: "string $path, $file, $options = []", ReturnType: "string|false"},
		{Name: "putFileAs", Params: "string $path, $file, string $name, $options = []", ReturnType: "string|false"},
		{Name: "exists", Params: "string $path", ReturnType: "bool"},
		{Name: "missing", Params: "string $path", ReturnType: "bool"},
		{Name: "delete", Params: "string|array $paths", ReturnType: "bool"},
		{Name: "copy", Params: "string $from, string $to", ReturnType: "bool"},
		{Name: "move", Params: "string $from, string $to", ReturnType: "bool"},
		{Name: "size", Params: "string $path", ReturnType: "int"},
		{Name: "lastModified", Params: "string $path", ReturnType: "int"},
		{Name: "files", Params: "string $directory = null, bool $recursive = false", ReturnType: "array"},
		{Name: "allFiles", Params: "string $directory = null", ReturnType: "array"},
		{Name: "directories", Params: "string $directory = null, bool $recursive = false", ReturnType: "array"},
		{Name: "allDirectories", Params: "string $directory = null", ReturnType: "array"},
		{Name: "makeDirectory", Params: "string $path", ReturnType: "bool"},
		{Name: "deleteDirectory", Params: "string $directory", ReturnType: "bool"},
		{Name: "url", Params: "string $path", ReturnType: "string"},
		{Name: "temporaryUrl", Params: "string $path, DateTimeInterface $expiration, array $options = []", ReturnType: "string"},
		{Name: "path", Params: "string $path", ReturnType: "string"},
		{Name: "download", Params: "string $path, string $name = null, array $headers = []", ReturnType: "StreamedResponse"},
	},
	"queue": {
		{Name: "connection", Params: "string $name = null", ReturnType: "Queue"},
		{Name: "push", Params: "string|object $job, mixed $data = '', string $queue = null", ReturnType: "mixed"},
		{Name: "pushOn", Params: "string $queue, string|object $job, mixed $data = ''", ReturnType: "mixed"},
		{Name: "pushRaw", Params: "string $payload, string $queue = null, array $options = []", ReturnType: "mixed"},
		{Name: "later", Params: "DateTimeInterface|DateInterval|int $delay, string|object $job, mixed $data = '', string $queue = null", ReturnType: "mixed"},
		{Name: "laterOn", Params: "string $queue, DateTimeInterface|DateInterval|int $delay, string|object $job, mixed $data = ''", ReturnType: "mixed"},
		{Name: "bulk", Params: "array $jobs, mixed $data = '', string $queue = null", ReturnType: "mixed"},
		{Name: "size", Params: "string $queue = null", ReturnType: "int"},
	},
	"mail": {
		{Name: "to", Params: "$users", ReturnType: "PendingMail"},
		{Name: "cc", Params: "$users", ReturnType: "PendingMail"},
		{Name: "bcc", Params: "$users", ReturnType: "PendingMail"},
		{Name: "send", Params: "Mailable $mailable", ReturnType: "SentMessage|null"},
		{Name: "queue", Params: "Mailable $mailable", ReturnType: "mixed"},
		{Name: "later", Params: "DateTimeInterface|DateInterval|int $delay, Mailable $mailable", ReturnType: "mixed"},
		{Name: "raw", Params: "string $text, Closure|string $callback", ReturnType: "SentMessage|null"},
		{Name: "plain", Params: "string $view, array $data, Closure|string $callback", ReturnType: "SentMessage|null"},
		{Name: "html", Params: "string $html, Closure|string $callback", ReturnType: "SentMessage|null"},
		{Name: "mailer", Params: "string $name = null", ReturnType: "Mailer"},
	},
	"hash": {
		{Name: "make", Params: "string $value, array $options = []", ReturnType: "string"},
		{Name: "check", Params: "string $value, string $hashedValue, array $options = []", ReturnType: "bool"},
		{Name: "needsRehash", Params: "string $hashedValue, array $options = []", ReturnType: "bool"},
		{Name: "driver", Params: "string $driver = null", ReturnType: "Hasher"},
		{Name: "info", Params: "string $hashedValue", ReturnType: "array"},
		{Name: "isHashed", Params: "string $value", ReturnType: "bool"},
	},
	"crypt": {
		{Name: "encrypt", Params: "mixed $value, bool $serialize = true", ReturnType: "string"},
		{Name: "encryptString", Params: "string $value", ReturnType: "string"},
		{Name: "decrypt", Params: "string $payload, bool $unserialize = true", ReturnType: "mixed"},
		{Name: "decryptString", Params: "string $payload", ReturnType: "string"},
		{Name: "generateKey", Params: "string $cipher", ReturnType: "string"},
		{Name: "getKey", Params: "", ReturnType: "string"},
	},
	"redirect": {
		{Name: "home", Params: "int $status = 302", ReturnType: "RedirectResponse"},
		{Name: "back", Params: "int $status = 302, array $headers = [], $fallback = false", ReturnType: "RedirectResponse"},
		{Name: "refresh", Params: "int $status = 302, array $headers = []", ReturnType: "RedirectResponse"},
		{Name: "guest", Params: "string $path, int $status = 302, array $headers = [], bool $secure = null", ReturnType: "RedirectResponse"},
		{Name: "intended", Params: "string $default = '/', int $status = 302, array $headers = [], bool $secure = null", ReturnType: "RedirectResponse"},
		{Name: "to", Params: "string $path, int $status = 302, array $headers = [], bool $secure = null", ReturnType: "RedirectResponse"},
		{Name: "away", Params: "string $path, int $status = 302, array $headers = []", ReturnType: "RedirectResponse"},
		{Name: "secure", Params: "string $path, int $status = 302, array $headers = []", ReturnType: "RedirectResponse"},
		{Name: "route", Params: "string $route, array $parameters = [], int $status = 302, array $headers = []", ReturnType: "RedirectResponse"},
		{Name: "action", Params: "string|array $action, array $parameters = [], int $status = 302, array $headers = []", ReturnType: "RedirectResponse"},
		{Name: "signedRoute", Params: "string $route, array $parameters = [], DateTimeInterface|int $expiration = null, int $status = 302, array $headers = []", ReturnType: "RedirectResponse"},
		{Name: "temporarySignedRoute", Params: "string $route, DateTimeInterface|int $expiration, array $parameters = [], int $status = 302, array $headers = []", ReturnType: "RedirectResponse"},
	},
	"url": {
		{Name: "current", Params: "", ReturnType: "string"},
		{Name: "full", Params: "", ReturnType: "string"},
		{Name: "previous", Params: "$fallback = false", ReturnType: "string"},
		{Name: "previousPath", Params: "$fallback = false", ReturnType: "string"},
		{Name: "to", Params: "string $path, mixed $extra = [], bool $secure = null", ReturnType: "string"},
		{Name: "secure", Params: "string $path, array $parameters = []", ReturnType: "string"},
		{Name: "asset", Params: "string $path, bool $secure = null", ReturnType: "string"},
		{Name: "secureAsset", Params: "string $path", ReturnType: "string"},
		{Name: "route", Params: "string $name, mixed $parameters = [], bool $absolute = true", ReturnType: "string"},
		{Name: "action", Params: "string|array $action, mixed $parameters = [], bool $absolute = true", ReturnType: "string"},
		{Name: "temporarySignedRoute", Params: "string $name, DateTimeInterface|DateInterval|int $expiration, array $parameters = [], bool $absolute = true", ReturnType: "string"},
		{Name: "signedRoute", Params: "string $name, array $parameters = [], DateTimeInterface|DateInterval|int $expiration = null, bool $absolute = true", ReturnType: "string"},
		{Name: "hasValidSignature", Params: "Request $request = null, bool $absolute = true, array $ignoreQuery = []", ReturnType: "bool"},
		{Name: "hasValidRelativeSignature", Params: "Request $request = null, array $ignoreQuery = []", ReturnType: "bool"},
		{Name: "hasCorrectSignature", Params: "Request $request, bool $absolute = true, array $ignoreQuery = []", ReturnType: "bool"},
		{Name: "signatureHasNotExpired", Params: "Request $request", ReturnType: "bool"},
		{Name: "isValidUrl", Params: "string $path", ReturnType: "bool"},
	},
	"app": {
		{Name: "version", Params: "", ReturnType: "string"},
		{Name: "basePath", Params: "string $path = ''", ReturnType: "string"},
		{Name: "bootstrapPath", Params: "string $path = ''", ReturnType: "string"},
		{Name: "configPath", Params: "string $path = ''", ReturnType: "string"},
		{Name: "databasePath", Params: "string $path = ''", ReturnType: "string"},
		{Name: "langPath", Params: "string $path = ''", ReturnType: "string"},
		{Name: "publicPath", Params: "string $path = ''", ReturnType: "string"},
		{Name: "resourcePath", Params: "string $path = ''", ReturnType: "string"},
		{Name: "storagePath", Params: "string $path = ''", ReturnType: "string"},
		{Name: "environment", Params: "string|array ...$environments", ReturnType: "string|bool"},
		{Name: "isLocal", Params: "", ReturnType: "bool"},
		{Name: "isProduction", Params: "", ReturnType: "bool"},
		{Name: "runningInConsole", Params: "", ReturnType: "bool"},
		{Name: "runningUnitTests", Params: "", ReturnType: "bool"},
		{Name: "hasDebugModeEnabled", Params: "", ReturnType: "bool"},
		{Name: "maintenanceMode", Params: "", ReturnType: "MaintenanceMode"},
		{Name: "isDownForMaintenance", Params: "", ReturnType: "bool"},
		{Name: "abort", Params: "int $code, string $message = '', array $headers = []", ReturnType: "never"},
		{Name: "make", Params: "string $abstract, array $parameters = []", ReturnType: "mixed"},
		{Name: "bound", Params: "string $abstract", ReturnType: "bool"},
		{Name: "resolved", Params: "string $abstract", ReturnType: "bool"},
		{Name: "call", Params: "callable|string $callback, array $parameters = [], string $defaultMethod = null", ReturnType: "mixed"},
		{Name: "getLocale", Params: "", ReturnType: "string"},
		{Name: "setLocale", Params: "string $locale", ReturnType: "void"},
		{Name: "currentLocale", Params: "", ReturnType: "string"},
		{Name: "isLocale", Params: "string $locale", ReturnType: "bool"},
	},
	"schema": {
		{Name: "create", Params: "string $table, Closure $callback", ReturnType: "void"},
		{Name: "drop", Params: "string $table", ReturnType: "void"},
		{Name: "dropIfExists", Params: "string $table", ReturnType: "void"},
		{Name: "dropColumns", Params: "string $table, string|array $columns", ReturnType: "void"},
		{Name: "dropAllTables", Params: "", ReturnType: "void"},
		{Name: "dropAllViews", Params: "", ReturnType: "void"},
		{Name: "dropAllTypes", Params: "", ReturnType: "void"},
		{Name: "rename", Params: "string $from, string $to", ReturnType: "void"},
		{Name: "table", Params: "string $table, Closure $callback", ReturnType: "void"},
		{Name: "hasTable", Params: "string $table", ReturnType: "bool"},
		{Name: "hasColumn", Params: "string $table, string $column", ReturnType: "bool"},
		{Name: "hasColumns", Params: "string $table, array $columns", ReturnType: "bool"},
		{Name: "getColumnType", Params: "string $table, string $column, bool $fullDefinition = false", ReturnType: "string"},
		{Name: "getColumnListing", Params: "string $table", ReturnType: "array"},
		{Name: "getConnection", Params: "", ReturnType: "Connection"},
		{Name: "connection", Params: "string $name", ReturnType: "Builder"},
		{Name: "enableForeignKeyConstraints", Params: "", ReturnType: "bool"},
		{Name: "disableForeignKeyConstraints", Params: "", ReturnType: "bool"},
		{Name: "withoutForeignKeyConstraints", Params: "Closure $callback", ReturnType: "mixed"},
	},
	"artisan": {
		{Name: "call", Params: "string $command, array $parameters = [], OutputInterface $outputBuffer = null", ReturnType: "int"},
		{Name: "queue", Params: "string $command, array $parameters = []", ReturnType: "PendingDispatch"},
		{Name: "output", Params: "", ReturnType: "string"},
	},
	"http": {
		{Name: "get", Params: "string $url, array|string|null $query = null", ReturnType: "Response"},
		{Name: "head", Params: "string $url, array|string|null $query = null", ReturnType: "Response"},
		{Name: "post", Params: "string $url, array $data = []", ReturnType: "Response"},
		{Name: "patch", Params: "string $url, array $data = []", ReturnType: "Response"},
		{Name: "put", Params: "string $url, array $data = []", ReturnType: "Response"},
		{Name: "delete", Params: "string $url, array $data = []", ReturnType: "Response"},
		{Name: "withHeaders", Params: "array $headers", ReturnType: "PendingRequest"},
		{Name: "withBody", Params: "string $content, string $contentType = 'application/json'", ReturnType: "PendingRequest"},
		{Name: "withToken", Params: "string $token, string $type = 'Bearer'", ReturnType: "PendingRequest"},
		{Name: "withBasicAuth", Params: "string $username, string $password", ReturnType: "PendingRequest"},
		{Name: "withDigestAuth", Params: "string $username, string $password", ReturnType: "PendingRequest"},
		{Name: "withCookies", Params: "array $cookies, string $domain", ReturnType: "PendingRequest"},
		{Name: "withOptions", Params: "array $options", ReturnType: "PendingRequest"},
		{Name: "withoutRedirecting", Params: "", ReturnType: "PendingRequest"},
		{Name: "withoutVerifying", Params: "", ReturnType: "PendingRequest"},
		{Name: "timeout", Params: "int $seconds", ReturnType: "PendingRequest"},
		{Name: "connectTimeout", Params: "int $seconds", ReturnType: "PendingRequest"},
		{Name: "retry", Params: "int $times, int $sleepMilliseconds = 0, callable $when = null, bool $throw = true", ReturnType: "PendingRequest"},
		{Name: "accept", Params: "string $contentType", ReturnType: "PendingRequest"},
		{Name: "acceptJson", Params: "", ReturnType: "PendingRequest"},
		{Name: "asJson", Params: "", ReturnType: "PendingRequest"},
		{Name: "asForm", Params: "", ReturnType: "PendingRequest"},
		{Name: "asMultipart", Params: "", ReturnType: "PendingRequest"},
		{Name: "attach", Params: "string|array $name, string $contents = '', string $filename = null, array $headers = []", ReturnType: "PendingRequest"},
		{Name: "baseUrl", Params: "string $url", ReturnType: "PendingRequest"},
		{Name: "pool", Params: "callable $callback", ReturnType: "array"},
		{Name: "fake", Params: "callable|array $callback = null", ReturnType: "Factory"},
		{Name: "fakeSequence", Params: "string $urlPattern = '*'", ReturnType: "ResponseSequence"},
		{Name: "preventStrayRequests", Params: "bool $prevent = true", ReturnType: "Factory"},
		{Name: "assertSent", Params: "callable $callback", ReturnType: "void"},
		{Name: "assertNotSent", Params: "callable $callback", ReturnType: "void"},
		{Name: "assertNothingSent", Params: "", ReturnType: "void"},
		{Name: "assertSentCount", Params: "int $count", ReturnType: "void"},
		{Name: "assertSequencesAreEmpty", Params: "", ReturnType: "void"},
	},
}

var laravelFacadeNames = []string{
	"Route", "DB", "Cache", "Config", "Auth", "Session", "Request", "Response",
	"Log", "View", "Validator", "Event", "Storage", "Queue", "Mail", "Hash",
	"Crypt", "Redirect", "URL", "App", "Schema", "Artisan", "Http",
}

func (b *PredictionBrain) fromFacadeMethods(ctx CompletionContext) []Suggestion {
	if ctx.Language != "php" && ctx.Language != "php-laravel" {
		return nil
	}
	if isCanceled(ctx) {
		return nil
	}

	var suggestions []Suggestion

	if ctx.IsStaticCall {
		accessClassName := extractClassFromAccessChain(ctx.AccessChain)
		if accessClassName == "" {
			return nil
		}

		classLower := strings.ToLower(accessClassName)
		methods, ok := laravelFacadeMethods[classLower]
		if !ok {
			return nil
		}

		prefixLower := strings.ToLower(ctx.Prefix)
		for _, m := range methods {
			nameLower := strings.ToLower(m.Name)
			if prefixLower != "" && !strings.HasPrefix(nameLower, prefixLower) {
				continue
			}

			// Policy: never emit snippet placeholders like $1/$2 in InsertText.
			// If we can't SmartFill real args, insert minimal callable form.
			insertText := m.Name + "()"

			suggestions = append(suggestions, Suggestion{
				Text:          m.Name,
				DisplayText:   m.Name,
				Kind:          core.SymbolKindMethod,
				Detail:        m.Params,
				Score:         0.95,
				Source:        core.SourcePredictive,
				Namespace:     accessClassName,
				ProofKind:     "self-static-member",
				InsertText:    insertText,
				TypeInfo:      m.ReturnType,
				Documentation: accessClassName + "::" + m.Name + "(" + m.Params + "): " + m.ReturnType,
			})
		}
		return suggestions
	}

	if ctx.Prefix == "" || ctx.IsMethodCall {
		return nil
	}

	prefixLower := strings.ToLower(ctx.Prefix)
	for _, facadeName := range laravelFacadeNames {
		facadeLower := strings.ToLower(facadeName)
		if !strings.HasPrefix(facadeLower, prefixLower) {
			continue
		}

		methods := laravelFacadeMethods[facadeLower]
		methodCount := len(methods)
		detail := "Laravel Facade"
		if methodCount > 0 {
			detail = fmt.Sprintf("Laravel Facade (%d methods)", methodCount)
		}

		suggestions = append(suggestions, Suggestion{
			Text:          facadeName,
			DisplayText:   facadeName + "::",
			Kind:          core.SymbolKindClass,
			Detail:        detail,
			Score:         0.92,
			Source:        core.SourcePredictive,
			InsertText:    facadeName + "::",
			Documentation: "Laravel " + facadeName + " Facade - static access to " + facadeLower + " services",
		})
	}

	return suggestions
}

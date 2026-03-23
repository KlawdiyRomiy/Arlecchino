import { useMemo, useCallback } from "react";
import {
  Terminal,
  Package,
  RefreshCw,
  Database,
  Trash2,
  PlayCircle,
  PlusCircle,
  FileCode,
  Settings,
  Box,
  Layers,
  Mail,
  Bell,
  Shield,
  Factory,
  Sprout,
  Zap,
  Server,
  Eye,
  Archive,
  HardDrive,
} from "lucide-react";
import * as App from "../../wailsjs/go/main/App";

interface Command {
  id: string;
  label: string;
  description?: string;
  category: "artisan" | "composer" | "file" | "system" | "git";
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void | Promise<void>;
  needsInput?: boolean;
  inputPlaceholder?: string;
}

interface UseCommandsOptions {
  onSuccess?: (message: string) => void;
  onError?: (error: string) => void;
  onOpenModal?: (modalType: string, data?: any) => void;
}

export const useCommands = (options: UseCommandsOptions = {}) => {
  const { onSuccess, onError, onOpenModal } = options;

  const handleResult = useCallback(
    (result: string | void, successMessage: string) => {
      onSuccess?.(successMessage);
      console.log(result || successMessage);
    },
    [onSuccess],
  );

  const parsePhpError = (message: string): string => {
    const syntaxMatch = message.match(
      /ParseError[:\s]+(.+?)\s+at\s+([^\s]+):(\d+)/i,
    );
    if (syntaxMatch) {
      return `Syntax error: ${syntaxMatch[1]}\nFile: ${syntaxMatch[2]}:${syntaxMatch[3]}`;
    }

    const fileMatch = message.match(/at\s+([^\s:]+\.php):(\d+)/i);
    if (fileMatch) {
      const mainError = message.split(/\[?\d+m/)[0].trim();
      const shortError =
        mainError.length > 200
          ? mainError.substring(0, 200) + "..."
          : mainError;
      return `${shortError}\nFile: ${fileMatch[1]}:${fileMatch[2]}`;
    }

    const classMatch = message.match(/Class\s+['"]?([^'"]+)['"]?\s+not found/i);
    if (classMatch) {
      return `Class not found: ${classMatch[1]}`;
    }

    const methodMatch = message.match(/Call to undefined method\s+([^\s(]+)/i);
    if (methodMatch) {
      return `Method not found: ${methodMatch[1]}`;
    }

    if (message.includes("exit status 1") && message.length < 50) {
      return "Command failed. Check console for details.";
    }

    if (message.length > 300) {
      const firstLine = message.split("\n")[0];
      if (firstLine.length > 200) {
        return firstLine.substring(0, 200) + "...";
      }
      return firstLine;
    }

    return message;
  };

  const handleError = useCallback(
    (error: unknown, context: string) => {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const parsedMessage = parsePhpError(rawMessage);
      onError?.(`${context}: ${parsedMessage}`);
      console.error(context, rawMessage);
    },
    [onError],
  );

  const artisanCommands: Command[] = useMemo(
    () => [
      {
        id: "migrate",
        label: "Run Migrations",
        description: "php artisan migrate",
        category: "artisan",
        icon: <Database size={16} className="text-blue-500" />,
        shortcut: "⌘+R+M",
        action: async () => {
          try {
            const result = await App.Migrate({
              Force: false,
              Step: 0,
              Path: "",
              Realpath: false,
            });
            handleResult(result, "Migrations completed successfully");
          } catch (e) {
            handleError(e, "Migration failed");
          }
        },
      },
      {
        id: "migrate-fresh",
        label: "Fresh Migration",
        description:
          "php artisan migrate:fresh - Drop all tables and re-run migrations",
        category: "artisan",
        icon: <RefreshCw size={16} className="text-gray-400" />,
        action: async () => {
          try {
            const result = await App.MigrateFresh({
              Seed: false,
              Step: 0,
              Path: "",
              Realpath: false,
            });
            handleResult(result, "Fresh migration completed");
          } catch (e) {
            handleError(e, "Fresh migration failed");
          }
        },
      },
      {
        id: "migrate-rollback",
        label: "Rollback Migration",
        description: "php artisan migrate:rollback",
        category: "artisan",
        icon: <Archive size={16} className="text-orange-500" />,
        action: async () => {
          try {
            const result = await App.MigrateRollback({
              Step: 1,
              Paths: [],
              Realpath: false,
            });
            handleResult(result, "Migration rolled back");
          } catch (e) {
            handleError(e, "Rollback failed");
          }
        },
      },
      {
        id: "migrate-status",
        label: "Migration Status",
        description: "php artisan migrate:status",
        category: "artisan",
        icon: <Eye size={16} className="text-gray-500" />,
        action: async () => {
          try {
            const result = await App.MigrateStatus();
            handleResult(result, "Migration status");
          } catch (e) {
            handleError(e, "Failed to get migration status");
          }
        },
      },
      {
        id: "db-seed",
        label: "Seed Database",
        description: "php artisan db:seed",
        category: "artisan",
        icon: <Sprout size={16} className="text-green-500" />,
        action: async () => {
          try {
            const result = await App.DBSeed("");
            handleResult(result, "Database seeded successfully");
          } catch (e) {
            handleError(e, "Seeding failed");
          }
        },
      },
      {
        id: "cache-clear",
        label: "Clear Cache",
        description: "php artisan cache:clear",
        category: "artisan",
        icon: <Trash2 size={16} className="text-gray-400" />,
        shortcut: "⌘+R+C",
        action: async () => {
          try {
            const result = await App.CacheClear({
              ExcludeGroups: [],
              IncludeGroups: [],
            });
            handleResult(result, "Cache cleared");
          } catch (e) {
            handleError(e, "Failed to clear cache");
          }
        },
      },
      {
        id: "config-cache",
        label: "Cache Config",
        description: "php artisan config:cache",
        category: "artisan",
        icon: <Settings size={16} className="text-purple-500" />,
        action: async () => {
          try {
            const result = await App.ConfigCache();
            handleResult(result, "Config cached");
          } catch (e) {
            handleError(e, "Failed to cache config");
          }
        },
      },
      {
        id: "route-cache",
        label: "Cache Routes",
        description: "php artisan route:cache",
        category: "artisan",
        icon: <Zap size={16} className="text-yellow-500" />,
        action: async () => {
          try {
            const result = await App.RouteCache();
            handleResult(result, "Routes cached");
          } catch (e) {
            handleError(e, "Failed to cache routes");
          }
        },
      },
      {
        id: "view-cache",
        label: "Cache Views",
        description: "php artisan view:cache",
        category: "artisan",
        icon: <Eye size={16} className="text-blue-400" />,
        action: async () => {
          try {
            const result = await App.ViewCache();
            handleResult(result, "Views cached");
          } catch (e) {
            handleError(e, "Failed to cache views");
          }
        },
      },
      {
        id: "clear-compiled",
        label: "Clear Compiled",
        description: "php artisan clear-compiled",
        category: "artisan",
        icon: <Trash2 size={16} className="text-gray-400" />,
        action: async () => {
          try {
            const result = await App.ClearCompiled();
            handleResult(result, "Compiled files cleared");
          } catch (e) {
            handleError(e, "Failed to clear compiled");
          }
        },
      },
      {
        id: "make-model",
        label: "Create Model",
        description: "php artisan make:model - Create a new Eloquent model",
        category: "artisan",
        icon: <Box size={16} className="text-green-500" />,
        action: () => {
          onOpenModal?.("make-model");
        },
      },
      {
        id: "make-controller",
        label: "Create Controller",
        description:
          "php artisan make:controller - Create a new controller class",
        category: "artisan",
        icon: <Layers size={16} className="text-blue-500" />,
        action: () => {
          onOpenModal?.("make-controller");
        },
      },
      {
        id: "make-migration",
        label: "Create Migration",
        description: "php artisan make:migration - Create a new migration file",
        category: "artisan",
        icon: <Database size={16} className="text-orange-500" />,
        action: () => {
          onOpenModal?.("make-migration");
        },
      },
      {
        id: "make-seeder",
        label: "Create Seeder",
        description: "php artisan make:seeder - Create a new seeder class",
        category: "artisan",
        icon: <Sprout size={16} className="text-green-400" />,
        action: () => {
          onOpenModal?.("make-seeder");
        },
      },
      {
        id: "make-factory",
        label: "Create Factory",
        description: "php artisan make:factory - Create a new model factory",
        category: "artisan",
        icon: <Factory size={16} className="text-purple-500" />,
        action: () => {
          onOpenModal?.("make-factory");
        },
      },
      {
        id: "make-mail",
        label: "Create Mailable",
        description: "php artisan make:mail - Create a new mailable class",
        category: "artisan",
        icon: <Mail size={16} className="text-gray-400" />,
        action: () => {
          onOpenModal?.("make-mail");
        },
      },
      {
        id: "make-notification",
        label: "Create Notification",
        description:
          "php artisan make:notification - Create a new notification",
        category: "artisan",
        icon: <Bell size={16} className="text-yellow-500" />,
        action: () => {
          onOpenModal?.("make-notification");
        },
      },
      {
        id: "make-policy",
        label: "Create Policy",
        description: "php artisan make:policy - Create a new policy class",
        category: "artisan",
        icon: <Shield size={16} className="text-indigo-500" />,
        action: () => {
          onOpenModal?.("make-policy");
        },
      },
      {
        id: "make-job",
        label: "Create Job",
        description: "php artisan make:job - Create a new queue job",
        category: "artisan",
        icon: <Zap size={16} className="text-cyan-500" />,
        action: () => {
          onOpenModal?.("make-job");
        },
      },
      {
        id: "make-event",
        label: "Create Event",
        description: "php artisan make:event - Create a new event class",
        category: "artisan",
        icon: <PlayCircle size={16} className="text-pink-500" />,
        action: () => {
          onOpenModal?.("make-event");
        },
      },
      {
        id: "make-resource",
        label: "Create Resource",
        description: "php artisan make:resource - Create a new API resource",
        category: "artisan",
        icon: <FileCode size={16} className="text-teal-500" />,
        action: () => {
          onOpenModal?.("make-resource");
        },
      },
      {
        id: "storage-link",
        label: "Create Storage Link",
        description: "php artisan storage:link",
        category: "artisan",
        icon: <HardDrive size={16} className="text-gray-500" />,
        action: async () => {
          try {
            const result = await App.StorageLink();
            handleResult(result, "Storage link created");
          } catch (e) {
            handleError(e, "Failed to create storage link");
          }
        },
      },
    ],
    [handleResult, handleError, onOpenModal],
  );

  const composerCommands: Command[] = useMemo(
    () => [
      {
        id: "composer-install",
        label: "Composer Install",
        description: "Install all dependencies from composer.lock",
        category: "composer",
        icon: <Package size={16} className="text-orange-500" />,
        action: async () => {
          try {
            await App.InstallAll();
            handleResult(undefined, "Dependencies installed");
          } catch (e) {
            handleError(e, "Composer install failed");
          }
        },
      },
      {
        id: "composer-update",
        label: "Composer Update",
        description: "Update all dependencies",
        category: "composer",
        icon: <RefreshCw size={16} className="text-orange-500" />,
        action: async () => {
          try {
            await App.UpdateAll();
            handleResult(undefined, "Dependencies updated");
          } catch (e) {
            handleError(e, "Composer update failed");
          }
        },
      },
      {
        id: "composer-dump",
        label: "Dump Autoload",
        description: "composer dump-autoload",
        category: "composer",
        icon: <RefreshCw size={16} className="text-yellow-500" />,
        action: async () => {
          try {
            await App.DumpAutoload();
            handleResult(undefined, "Autoload dumped");
          } catch (e) {
            handleError(e, "Dump autoload failed");
          }
        },
      },
      {
        id: "composer-require",
        label: "Require Package",
        description: "Add a new package to the project",
        category: "composer",
        icon: <PlusCircle size={16} className="text-green-500" />,
        action: () => {
          onOpenModal?.("composer-require");
        },
      },
      {
        id: "composer-list",
        label: "List Packages",
        description: "Show all installed packages",
        category: "composer",
        icon: <Package size={16} className="text-gray-500" />,
        action: async () => {
          try {
            const result = await App.ListInstalledPackages();
            handleResult(result, "Package list");
          } catch (e) {
            handleError(e, "Failed to list packages");
          }
        },
      },
      {
        id: "install-livewire",
        label: "Install Livewire",
        description: "livewire/livewire - Full-stack framework for Laravel",
        category: "composer",
        icon: <Zap size={16} className="text-pink-500" />,
        action: async () => {
          try {
            await App.InstallLivewire();
            handleResult(undefined, "Livewire installed");
          } catch (e) {
            handleError(e, "Failed to install Livewire");
          }
        },
      },
      {
        id: "install-breeze",
        label: "Install Breeze",
        description: "laravel/breeze - Lightweight authentication scaffolding",
        category: "composer",
        icon: <Shield size={16} className="text-blue-500" />,
        action: async () => {
          try {
            await App.InstallBreeze();
            handleResult(undefined, "Breeze installed");
          } catch (e) {
            handleError(e, "Failed to install Breeze");
          }
        },
      },
      {
        id: "install-jetstream",
        label: "Install Jetstream",
        description: "laravel/jetstream - Full authentication scaffolding",
        category: "composer",
        icon: <Server size={16} className="text-indigo-500" />,
        action: async () => {
          try {
            await App.InstallJetstream();
            handleResult(undefined, "Jetstream installed");
          } catch (e) {
            handleError(e, "Failed to install Jetstream");
          }
        },
      },
      {
        id: "install-fortify",
        label: "Install Fortify",
        description: "laravel/fortify - Backend authentication",
        category: "composer",
        icon: <Shield size={16} className="text-purple-500" />,
        action: async () => {
          try {
            await App.InstallFortify();
            handleResult(undefined, "Fortify installed");
          } catch (e) {
            handleError(e, "Failed to install Fortify");
          }
        },
      },
    ],
    [handleResult, handleError, onOpenModal],
  );

  const systemCommands: Command[] = useMemo(
    () => [
      {
        id: "artisan-serve",
        label: "Start Development Server",
        description: "php artisan serve - Start the Laravel development server",
        category: "system",
        icon: <PlayCircle size={16} className="text-green-500" />,
        shortcut: "⌘+R+S",
        action: async () => {
          try {
            await App.Serve({
              Host: "127.0.0.1",
              Port: "8000",
              Env: "",
              ForceHttps: false,
            });
            handleResult(undefined, "Server started at http://127.0.0.1:8000");
          } catch (e) {
            handleError(e, "Failed to start server");
          }
        },
      },
      {
        id: "schedule-run",
        label: "Run Scheduler",
        description: "php artisan schedule:run",
        category: "system",
        icon: <RefreshCw size={16} className="text-blue-500" />,
        action: async () => {
          try {
            const result = await App.ScheduleRun();
            handleResult(result, "Scheduler executed");
          } catch (e) {
            handleError(e, "Failed to run scheduler");
          }
        },
      },
      {
        id: "queue-work",
        label: "Start Queue Worker",
        description: "php artisan queue:work",
        category: "system",
        icon: <Zap size={16} className="text-yellow-500" />,
        action: async () => {
          try {
            await App.QueueWork("", "");
            handleResult(undefined, "Queue worker started");
          } catch (e) {
            handleError(e, "Failed to start queue worker");
          }
        },
      },
      {
        id: "debug-project-structure",
        label: "Debug: Show Project Structure",
        description: "Inspect project structure and log to console",
        category: "system",
        icon: <Eye size={16} className="text-gray-400" />,
        action: async () => {
          try {
            const result = await App.InspectProject();
            console.log("Project Structure:", result);
            handleResult(
              JSON.stringify(result, null, 2),
              "Project structure logged to console",
            );
          } catch (e) {
            handleError(e, "Failed to inspect project");
          }
        },
      },
    ],
    [handleResult, handleError],
  );

  return {
    artisanCommands,
    composerCommands,
    systemCommands,
    allCommands: [...artisanCommands, ...composerCommands, ...systemCommands],
  };
};

export default useCommands;

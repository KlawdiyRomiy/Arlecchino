import React, { useState } from "react";
import {
  X,
  Check,
  Box,
  Layers,
  Database,
  Sprout,
  Factory,
  Mail,
  Bell,
  Shield,
  Zap,
  FileCode,
  PlayCircle,
  Package,
} from "lucide-react";
import * as App from "../wails/app";

interface ArtisanFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  modalType: string;
  onSuccess?: (message: string) => void;
  onError?: (error: string) => void;
}

interface FormField {
  name: string;
  label: string;
  type: "text" | "checkbox" | "select";
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
}

const formConfigs: Record<
  string,
  {
    title: string;
    icon: React.ReactNode;
    description: string;
    fields: FormField[];
    handler: (name: string, options: any) => Promise<void>;
  }
> = {
  "make-model": {
    title: "Create Model",
    icon: <Box size={20} className="text-green-500" />,
    description: "Create a new application model class",
    fields: [
      {
        name: "name",
        label: "Model Name",
        type: "text",
        placeholder: "Post",
        required: true,
      },
      { name: "migration", label: "Create Migration", type: "checkbox" },
      { name: "factory", label: "Create Factory", type: "checkbox" },
      { name: "seeder", label: "Create Seeder", type: "checkbox" },
      { name: "controller", label: "Create Controller", type: "checkbox" },
      { name: "resource", label: "Resource Controller", type: "checkbox" },
      { name: "policy", label: "Create Policy", type: "checkbox" },
      { name: "all", label: "All (-a)", type: "checkbox" },
    ],
    handler: async (name, opts) => {
      await App.CreateModel(name, {
        All: opts.all || false,
        Controller: opts.controller || false,
        Factory: opts.factory || false,
        Invokable: false,
        Migration: opts.migration || false,
        Policy: opts.policy || false,
        Resource: opts.resource || false,
        Seeder: opts.seeder || false,
      });
    },
  },
  "make-controller": {
    title: "Create Controller",
    icon: <Layers size={20} className="text-blue-500" />,
    description: "Create a new controller class",
    fields: [
      {
        name: "name",
        label: "Controller Name",
        type: "text",
        placeholder: "PostController",
        required: true,
      },
      { name: "resource", label: "Resource Controller", type: "checkbox" },
      { name: "api", label: "API Controller", type: "checkbox" },
      {
        name: "invokable",
        label: "Invokable (Single Action)",
        type: "checkbox",
      },
      {
        name: "model",
        label: "Model Name (optional)",
        type: "text",
        placeholder: "Post",
      },
      { name: "requests", label: "Generate Form Requests", type: "checkbox" },
    ],
    handler: async (name, opts) => {
      await App.CreateController(name, {
        Resource: opts.resource || false,
        Api: opts.api || false,
        Plain: false,
        Invokable: opts.invokable || false,
        Model: opts.model || "",
        Parent: "",
        Singleton: false,
        Requests: opts.requests || false,
      });
    },
  },
  "make-seeder": {
    title: "Create Seeder",
    icon: <Sprout size={20} className="text-green-400" />,
    description: "Create a new database seeder class",
    fields: [
      {
        name: "name",
        label: "Seeder Name",
        type: "text",
        placeholder: "PostSeeder",
        required: true,
      },
    ],
    handler: async (name, opts) => {
      await App.CreateSeeder(name, {
        Force: false,
        Class: "",
      });
    },
  },
  "make-factory": {
    title: "Create Factory",
    icon: <Factory size={20} className="text-purple-500" />,
    description: "Create a new model factory",
    fields: [
      {
        name: "name",
        label: "Factory Name",
        type: "text",
        placeholder: "PostFactory",
        required: true,
      },
      { name: "model", label: "Model Name", type: "text", placeholder: "Post" },
    ],
    handler: async (name, opts) => {
      await App.CreateFactory(name, {
        Force: false,
        Model: opts.model || "",
        Seeded: false,
      });
    },
  },
  "make-mail": {
    title: "Create Mailable",
    icon: <Mail size={20} className="text-gray-400" />,
    description: "Create a new mailable class",
    fields: [
      {
        name: "name",
        label: "Mailable Name",
        type: "text",
        placeholder: "WelcomeMail",
        required: true,
      },
      {
        name: "markdown",
        label: "Markdown Template",
        type: "text",
        placeholder: "emails.welcome",
      },
    ],
    handler: async (name, opts) => {
      await App.CreateMail(name, {
        Markdown: opts.markdown || "",
      });
    },
  },
  "make-notification": {
    title: "Create Notification",
    icon: <Bell size={20} className="text-yellow-500" />,
    description: "Create a new notification class",
    fields: [
      {
        name: "name",
        label: "Notification Name",
        type: "text",
        placeholder: "OrderShipped",
        required: true,
      },
    ],
    handler: async (name, opts) => {
      await App.CreateNotification(name, {
        Force: false,
      });
    },
  },
  "make-policy": {
    title: "Create Policy",
    icon: <Shield size={20} className="text-indigo-500" />,
    description: "Create a new policy class",
    fields: [
      {
        name: "name",
        label: "Policy Name",
        type: "text",
        placeholder: "PostPolicy",
        required: true,
      },
      { name: "model", label: "Model Name", type: "text", placeholder: "Post" },
    ],
    handler: async (name, opts) => {
      await App.CreatePolicy(name, {
        Force: false,
        Model: opts.model || "",
        Guard: "",
        Resource: false,
      });
    },
  },
  "make-job": {
    title: "Create Job",
    icon: <Zap size={20} className="text-cyan-500" />,
    description: "Create a new queue job class",
    fields: [
      {
        name: "name",
        label: "Job Name",
        type: "text",
        placeholder: "ProcessPodcast",
        required: true,
      },
      { name: "sync", label: "Synchronous (not queued)", type: "checkbox" },
    ],
    handler: async (name, opts) => {
      await App.CreateJob(name, {
        Sync: opts.sync || false,
      });
    },
  },
  "make-event": {
    title: "Create Event",
    icon: <PlayCircle size={20} className="text-pink-500" />,
    description: "Create a new event class",
    fields: [
      {
        name: "name",
        label: "Event Name",
        type: "text",
        placeholder: "OrderCreated",
        required: true,
      },
    ],
    handler: async (name, opts) => {
      await App.CreateEvent(name, {
        Force: false,
      });
    },
  },
  "make-resource": {
    title: "Create Resource",
    icon: <FileCode size={20} className="text-teal-500" />,
    description: "Create a new API resource class",
    fields: [
      {
        name: "name",
        label: "Resource Name",
        type: "text",
        placeholder: "PostResource",
        required: true,
      },
      { name: "collection", label: "Resource Collection", type: "checkbox" },
      { name: "model", label: "Model Name", type: "text", placeholder: "Post" },
    ],
    handler: async (name, opts) => {
      await App.CreateResource(name, {
        Collection: opts.collection || false,
        Force: false,
        Invokable: false,
        Model: opts.model || "",
      });
    },
  },
  "make-migration": {
    title: "Create Migration",
    icon: <Database size={20} className="text-amber-500" />,
    description: "Create a new database migration file",
    fields: [
      {
        name: "name",
        label: "Migration Name",
        type: "text",
        placeholder: "create_posts_table",
        required: true,
      },
      {
        name: "create",
        label: "Table to Create",
        type: "text",
        placeholder: "posts",
      },
      {
        name: "table",
        label: "Existing Table to Modify",
        type: "text",
        placeholder: "users",
      },
    ],
    handler: async (name, opts) => {
      await App.CreateMigration(name, {
        Create: opts.create || "",
        Table: opts.table || "",
        Path: "",
        Force: false,
      });
    },
  },
  "composer-require": {
    title: "Require Package",
    icon: <Package size={20} className="text-orange-500" />,
    description: "Add a new Composer package",
    fields: [
      {
        name: "name",
        label: "Package Name",
        type: "text",
        placeholder: "spatie/laravel-permission",
        required: true,
      },
      { name: "dev", label: "Dev Dependency (--dev)", type: "checkbox" },
    ],
    handler: async (name, opts) => {
      await App.InstallPackage(name, {
        Dev: opts.dev || false,
        NoDev: false,
        Optimize: false,
        NoScripts: false,
        Update: false,
        IgnorePlatformReqs: false,
      });
    },
  },
};

export const ArtisanFormModal: React.FC<ArtisanFormModalProps> = ({
  isOpen,
  onClose,
  modalType,
  onSuccess,
  onError,
}) => {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(false);

  const config = formConfigs[modalType];

  if (!isOpen || !config) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const name = formData.name?.trim();
    if (!name) {
      onError?.("Name is required");
      return;
    }

    setIsLoading(true);

    try {
      await config.handler(name, formData);
      onSuccess?.(`${config.title} completed successfully`);
      setFormData({});
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onError?.(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            {config.icon}
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {config.title}
              </h2>
              <p className="text-xs text-gray-500">{config.description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col max-h-[60vh]">
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            {config.fields.map((field) => (
              <div key={field.name}>
                {field.type === "text" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {field.label}
                      {field.required && (
                        <span className="text-red-500 ml-1">*</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={formData[field.name] || ""}
                      onChange={(e) => handleChange(field.name, e.target.value)}
                      placeholder={field.placeholder}
                      required={field.required}
                      className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500"
                    />
                  </div>
                )}

                {field.type === "checkbox" && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData[field.name] || false}
                      onChange={(e) =>
                        handleChange(field.name, e.target.checked)
                      }
                      className="w-4 h-4 text-red-500 border-gray-300 rounded focus:ring-red-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {field.label}
                    </span>
                  </label>
                )}

                {field.type === "select" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {field.label}
                    </label>
                    <select
                      value={formData[field.name] || ""}
                      onChange={(e) => handleChange(field.name, e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500"
                    >
                      <option value="">Select...</option>
                      {field.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-black border-2 border-black/30 border-t-black bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check size={16} />
                  Create
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ArtisanFormModal;

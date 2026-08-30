export interface DetectedMetadata {
  runtime?: string;
  framework?: string;
}

export class FrameworkDetector {
  /**
   * Detects runtime and framework based on process name, command line, and port.
   */
  public static detect(processName: string, commandLine?: string, port?: number): DetectedMetadata {
    const pName = (processName || '').toLowerCase();
    const cmd = (commandLine || '').toLowerCase();
    let runtime: string | undefined;
    let framework: string | undefined;

    // Detect Runtime
    if (pName.includes('node') || cmd.includes('node') || pName.includes('bun') || pName.includes('deno')) {
      runtime = pName.includes('bun') ? 'bun' : pName.includes('deno') ? 'deno' : 'node';
    } else if (pName.includes('python') || cmd.includes('python') || pName.includes('uvicorn') || pName.includes('gunicorn')) {
      runtime = 'python';
    } else if (pName.includes('java') || pName.includes('javaw') || cmd.includes('java')) {
      runtime = 'java';
    } else if (pName.includes('dotnet') || cmd.includes('dotnet')) {
      runtime = 'dotnet';
    } else if (pName.includes('go') || cmd.includes('go run')) {
      runtime = 'go';
    } else if (pName.includes('ruby') || cmd.includes('ruby') || pName.includes('puma')) {
      runtime = 'ruby';
    } else if (pName.includes('php') || cmd.includes('php')) {
      runtime = 'php';
    } else if (pName.includes('postgres') || pName.includes('pg_ctl')) {
      runtime = 'postgres';
      framework = 'PostgreSQL';
    } else if (pName.includes('mysqld') || pName.includes('mariadbd')) {
      runtime = 'mysql';
      framework = 'MySQL / MariaDB';
    } else if (pName.includes('redis-server')) {
      runtime = 'redis';
      framework = 'Redis';
    } else if (pName.includes('nginx')) {
      runtime = 'nginx';
      framework = 'Nginx';
    } else if (pName.includes('docker') || pName.includes('com.docker')) {
      runtime = 'docker';
      framework = 'Docker';
    }

    // Node Frameworks
    if (runtime === 'node' || runtime === 'bun' || runtime === 'deno') {
      if (cmd.includes('next') || (port === 3000 && (cmd.includes('next') || !framework))) {
        if (cmd.includes('next')) framework = 'Next.js';
      }
      if (cmd.includes('vite') || port === 5173 || port === 5174) {
        if (cmd.includes('vite') || port === 5173) framework = 'Vite';
      }
      if (cmd.includes('react-scripts') || (cmd.includes('react') && !framework)) {
        framework = 'React';
      }
      if (cmd.includes('remix')) {
        framework = 'Remix';
      }
      if (cmd.includes('astro') || port === 4321) {
        if (cmd.includes('astro') || port === 4321) framework = 'Astro';
      }
      if (cmd.includes('nuxt')) {
        framework = 'Nuxt';
      }
      if (cmd.includes('svelte') || cmd.includes('kit.svelte.dev')) {
        framework = 'SvelteKit';
      }
      if (cmd.includes('nest') || cmd.includes('@nestjs')) {
        framework = 'NestJS';
      }
      if (cmd.includes('express') || cmd.includes('server.js') || cmd.includes('app.js')) {
        if (!framework) framework = 'Express';
      }
      if (cmd.includes('storybook') || port === 6006) {
        framework = 'Storybook';
      }
      if (cmd.includes('webpack') || (port === 8080 && cmd.includes('webpack'))) {
        framework = 'Webpack Dev Server';
      }
    }

    // Python Frameworks
    if (runtime === 'python') {
      if (cmd.includes('uvicorn') || cmd.includes('fastapi')) {
        framework = 'FastAPI';
      } else if (cmd.includes('manage.py runserver') || cmd.includes('django')) {
        framework = 'Django';
      } else if (cmd.includes('flask') || cmd.includes('app.py')) {
        framework = 'Flask';
      } else if (cmd.includes('streamlit') || port === 8501) {
        framework = 'Streamlit';
      } else if (cmd.includes('tornado')) {
        framework = 'Tornado';
      }
    }

    // Java Frameworks
    if (runtime === 'java') {
      if (cmd.includes('spring') || cmd.includes('org.springframework.boot') || port === 8080) {
        framework = 'Spring Boot';
      } else if (cmd.includes('quarkus')) {
        framework = 'Quarkus';
      } else if (cmd.includes('catalina') || cmd.includes('tomcat')) {
        framework = 'Tomcat';
      }
    }

    // Dotnet Frameworks
    if (runtime === 'dotnet') {
      framework = 'ASP.NET Core';
    }

    // PHP Frameworks
    if (runtime === 'php') {
      if (cmd.includes('artisan')) {
        framework = 'Laravel';
      } else if (cmd.includes('symfony')) {
        framework = 'Symfony';
      } else {
        framework = 'PHP Server';
      }
    }

    // Common standard ports fallback
    if (!framework && port) {
      if (port === 5432) framework = 'PostgreSQL';
      else if (port === 3306) framework = 'MySQL';
      else if (port === 6379) framework = 'Redis';
      else if (port === 27017) framework = 'MongoDB';
      else if (port === 9200) framework = 'Elasticsearch';
      else if (port === 9092) framework = 'Kafka';
      else if (port === 8080 && !runtime) framework = 'HTTP Server (8080)';
      else if (port === 3000 && !runtime) framework = 'Web Server (3000)';
    }

    return { runtime, framework };
  }
}

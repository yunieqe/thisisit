import { pool, connectDatabase } from './config/database';
import fs from 'fs';
import path from 'path';
import { runSystemSettingsMigration } from './database/migrations/system_settings';

/**
 * Parse SQL statements properly handling dollar-quoted strings
 */
function parseSQLStatements(sql: string): string[] {
  const statements: string[] = [];
  let currentStatement = '';
  let inDollarQuote = false;
  let dollarQuoteTag = '';
  
  const lines = sql.split('\n');
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip empty lines and comments when not in a dollar quote
    if (!inDollarQuote && (trimmedLine === '' || trimmedLine.startsWith('--'))) {
      if (currentStatement.trim()) {
        currentStatement += '\n';
      }
      continue;
    }
    
    // Check for dollar quotes
    const dollarQuoteMatches = line.match(/\$([^$]*)\$/g);
    if (dollarQuoteMatches) {
      for (const match of dollarQuoteMatches) {
        if (!inDollarQuote) {
          inDollarQuote = true;
          dollarQuoteTag = match;
        } else if (match === dollarQuoteTag) {
          inDollarQuote = false;
          dollarQuoteTag = '';
        }
      }
    }
    
    currentStatement += line + '\n';
    
    // If we're not in a dollar quote and the line ends with semicolon, it's a statement end
    if (!inDollarQuote && trimmedLine.endsWith(';')) {
      const cleanStatement = currentStatement.trim();
      if (cleanStatement && cleanStatement.length > 10) {
        statements.push(cleanStatement);
      }
      currentStatement = '';
    }
  }
  
  // Add any remaining statement
  const cleanStatement = currentStatement.trim();
  if (cleanStatement && cleanStatement.length > 10) {
    statements.push(cleanStatement);
  }
  
  return statements;
}

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applied_migrations (
      id SERIAL PRIMARY KEY,
      migration_name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function isMigrationApplied(migrationName: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM applied_migrations WHERE migration_name = $1',
    [migrationName]
  );
  return result.rows.length > 0;
}

async function markMigrationAsApplied(migrationName: string) {
  await pool.query(
    'INSERT INTO applied_migrations (migration_name) VALUES ($1) ON CONFLICT (migration_name) DO NOTHING',
    [migrationName]
  );
}

async function runMigrations() {
  try {
    console.log('Starting database migrations...');
    
    // Ensure database connection is established
    await connectDatabase();
    
    // Create migrations tracking table
    await ensureMigrationsTable();
    
    // First, run SQL migrations from root database directory
    const databasePath = path.join(__dirname, 'database');
    let rootFiles: string[] = [];
    
    try {
      rootFiles = fs.readdirSync(databasePath).filter(file => file.endsWith('.sql') && file.startsWith('migrate-'));
    } catch (error) {
      console.log('No root database directory found or no migrate-*.sql files');
    }
    
    for (const file of rootFiles.sort()) {
      if (await isMigrationApplied(file)) {
        console.log(`⏭️  Skipping (already applied): ${file}`);
        continue;
      }
      
      const filePath = path.join(databasePath, file);
      console.log(`Running root SQL migration: ${file}`);
      try {
        const sql = fs.readFileSync(filePath, { encoding: 'utf-8' });
        await pool.query(sql);
        await markMigrationAsApplied(file);
        console.log(`✓ Completed: ${file}`);
      } catch (error) {
        console.error(`✗ Failed to run migration ${file}:`, error);
        throw error;
      }
    }
    
    // Then run migrations from migrations directory
    const migrationsPath = path.join(__dirname, 'database', 'migrations');
    let files: string[] = [];
    
    try {
      files = fs.readdirSync(migrationsPath).sort();
    } catch (error) {
      console.log('No migrations directory found');
    }

    for (const file of files) {
      if (!file.endsWith('.sql')) {
        continue;
      }
      
      // Skip rollback migrations
      if (file.includes('rollback')) {
        console.log(`⏭️  Skipping rollback migration: ${file}`);
        continue;
      }
      
      if (await isMigrationApplied(file)) {
        console.log(`⏭️  Skipping (already applied): ${file}`);
        continue;
      }
      
      const filePath = path.join(migrationsPath, file);
      console.log(`Running SQL migration: ${file}`);
      
      try {
        const sql = fs.readFileSync(filePath, { encoding: 'utf-8' });
        
        // Special handling for payment_tracking_migration.sql
        if (file === 'payment_tracking_migration.sql') {
          // Check if the columns already exist
          const checkResult = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'transactions' 
            AND column_name IN ('paid_amount', 'balance_amount', 'payment_status')
          `);
          
          if (checkResult.rows.length >= 3) {
            console.log(`⏭️  Skipping ${file} - columns already exist`);
            await markMigrationAsApplied(file);
            continue;
          }
        }
        
        // For complex migrations with multiple statements, try to execute them separately
        if (file.includes('views') || file.includes('functions') || sql.includes('CREATE OR REPLACE VIEW') || sql.includes('CREATE OR REPLACE FUNCTION')) {
          // Use proper SQL parsing that handles dollar-quoted strings
          const statements = parseSQLStatements(sql);
          for (const statement of statements) {
            if (statement.length > 10) { // Skip empty/comment-only statements
              try {
                await pool.query(statement);
              } catch (stmtError) {
                console.error(`Error in statement: ${statement.substring(0, 100)}...`);
                throw stmtError;
              }
            }
          }
        } else {
          await pool.query(sql);
        }
        await markMigrationAsApplied(file);
        console.log(`✓ Completed: ${file}`);
      } catch (error) {
        console.error(`✗ Failed to run migration ${file}:`, error);
        // Don't throw for column already exists errors
        if (error && typeof error === 'object' && 'code' in error && error.code === '42701') {
          console.log(`⏭️  Marking as applied (column already exists): ${file}`);
          await markMigrationAsApplied(file);
        } else {
          throw error;
        }
      }
    }

    // Run TypeScript migrations
    try {
      if (!(await isMigrationApplied('system_settings.ts'))) {
        await runSystemSettingsMigration();
        await markMigrationAsApplied('system_settings.ts');
        console.log('✓ Completed: system_settings.ts');
      } else {
        console.log('⏭️  Skipping (already applied): system_settings.ts');
      }
    } catch (error) {
      console.error('✗ Failed to run system settings migration:', error);
      throw error;
    }

    console.log('✅ All migrations completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    // Close database connection
    if (pool && pool.end) {
      await pool.end();
    }
  }
}

runMigrations()
  .then(() => {
    console.log('Migration process completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration process failed:', error);
    process.exit(1);
  });

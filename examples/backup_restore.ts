/**
 * Backup & Restore Example
 *
 * This example demonstrates data integrity and backup features:
 * - Creating and validating backups
 * - Restoring from backup files
 * - Verifying data integrity
 * - Repairing corrupted data
 * - Export/import workflows
 *
 * Run with: deno run -A examples/backup_restore.ts
 */

import { openJsonlStore } from "../src/store_jsonl.ts";
import { createIssue, addLink } from "../src/domain.ts";
import {
  createBackup,
  exportToFile,
  importFromFile,
  validateBackup,
  exportToJsonl,
  importFromJsonl,
} from "../src/backup.ts";
import {
  verifyIntegrity,
  formatIntegrityReport,
  repairEvents,
} from "../src/integrity.ts";

const env = { now: () => new Date().toISOString() };

async function main() {
  console.log("💾 Trinkets Backup & Restore Example\n");

  const tempDir = await Deno.makeTempDir();
  const store = await openJsonlStore({ baseDir: tempDir });

  // 1. Create sample data
  console.log("📝 Creating sample project data...\n");

  const epic = await createIssue(store, env, {
    title: "Build Authentication System",
    kind: "epic",
    priority: 3,
  });

  const feature1 = await createIssue(store, env, {
    title: "JWT Implementation",
    kind: "feature",
    priority: 3,
  });

  const feature2 = await createIssue(store, env, {
    title: "OAuth Integration",
    kind: "feature",
    priority: 2,
  });

  const bug = await createIssue(store, env, {
    title: "Fix token expiration",
    kind: "bug",
    priority: 3,
  });

  if (!epic.ok || !feature1.ok || !feature2.ok || !bug.ok) {
    console.error("❌ Failed to create issues");
    return;
  }

  // Create relationships
  await addLink(store, env, {
    from: epic.value.id,
    to: feature1.value.id,
    type: "parent-child",
  });

  await addLink(store, env, {
    from: epic.value.id,
    to: feature2.value.id,
    type: "parent-child",
  });

  console.log(`✓ Created epic with ${2} features and ${1} bug\n`);

  // 2. Verify data integrity
  console.log("🔍 Verifying data integrity...\n");

  const scanResult = await store.scan();
  if (!scanResult.ok) {
    console.error("❌ Failed to scan events");
    return;
  }

  const integrityResult = verifyIntegrity(scanResult.value);
  if (!integrityResult.ok) {
    console.error("❌ Integrity verification failed");
    return;
  }

  const report = formatIntegrityReport(integrityResult.value);
  console.log(report);
  console.log();

  // 3. Create a backup
  console.log("💾 Creating backup...\n");

  const backup = createBackup(scanResult.value, "1.0");
  console.log("✓ Backup created:");
  console.log(`  Version: ${backup.metadata.version}`);
  console.log(`  Timestamp: ${backup.metadata.timestamp}`);
  console.log(`  Event count: ${backup.metadata.eventCount}`);
  console.log();

  // 4. Export backup to JSON file
  console.log("📤 Exporting backup to JSON file...\n");

  const backupPath = `${tempDir}/backup.json`;
  const exportResult = await exportToFile(scanResult.value, backupPath, "1.0");

  if (!exportResult.ok) {
    console.error(`❌ Export failed: ${exportResult.error._type}`);
    return;
  }

  console.log(`✓ Backup exported to: ${backupPath}\n`);

  // 5. Validate backup file
  console.log("✅ Validating backup file...\n");

  const backupContent = await Deno.readTextFile(backupPath);
  const backupData = JSON.parse(backupContent);
  const validationResult = validateBackup(backupData);

  if (validationResult.ok) {
    console.log("✓ Backup file is valid");
    console.log(`  Events: ${validationResult.value.events.length}`);
    console.log(`  Version: ${validationResult.value.metadata.version}`);
    console.log();
  }

  // 6. Import from backup
  console.log("📥 Importing from backup file...\n");

  const importResult = await importFromFile(backupPath);

  if (!importResult.ok) {
    console.error(`❌ Import failed: ${importResult.error._type}`);
    return;
  }

  console.log(`✓ Imported ${importResult.value.length} events\n`);

  // 7. Export to JSONL format (more compact)
  console.log("📦 Exporting to JSONL format...\n");

  const jsonlPath = `${tempDir}/backup.jsonl`;
  const jsonlExport = await exportToJsonl(scanResult.value, jsonlPath);

  if (jsonlExport.ok) {
    const jsonSize = (await Deno.stat(backupPath)).size;
    const jsonlSize = (await Deno.stat(jsonlPath)).size;

    console.log("✓ JSONL export completed");
    console.log(`  JSON size: ${jsonSize} bytes`);
    console.log(`  JSONL size: ${jsonlSize} bytes`);
    console.log(
      `  Space saved: ${((1 - jsonlSize / jsonSize) * 100).toFixed(1)}%`,
    );
    console.log();
  }

  // 8. Import from JSONL
  const jsonlImport = await importFromJsonl(jsonlPath);

  if (jsonlImport.ok) {
    console.log(`✓ Imported ${jsonlImport.value.length} events from JSONL\n`);
  }

  // 9. Simulate corruption and repair
  console.log("🔧 Demonstrating data repair...\n");

  // Create corrupted data by duplicating an event
  const corrupted = [...scanResult.value, scanResult.value[0]!];
  console.log("⚠️  Simulated corruption (duplicated event)");

  // Verify corruption is detected
  const corruptedCheck = verifyIntegrity(corrupted);
  if (corruptedCheck.ok && !corruptedCheck.value.healthy) {
    console.log(`✓ Corruption detected: ${corruptedCheck.value.issues.length} issues`);
    console.log();
  }

  // Repair the data
  const repairResult = repairEvents(corrupted);

  if (repairResult.ok) {
    console.log("✓ Data repaired:");
    console.log(`  Events removed: ${repairResult.value.removed}`);
    console.log(`  Issues found: ${repairResult.value.issues.length}`);
    console.log(`  Clean events: ${repairResult.value.events.length}`);
    console.log();

    // Verify repaired data
    const repairedCheck = verifyIntegrity(repairResult.value.events);
    if (repairedCheck.ok) {
      console.log(`✓ Repaired data is ${repairedCheck.value.healthy ? "healthy" : "still corrupted"}`);
      console.log();
    }
  }

  // 10. Disaster recovery simulation
  console.log("🚨 Simulating disaster recovery...\n");

  // Create a new store directory (simulating data loss)
  const recoveryDir = await Deno.makeTempDir();
  console.log("⚠️  Simulated data loss (empty store)");

  // Restore from backup
  const recoveredEvents = await importFromFile(backupPath);

  if (recoveredEvents.ok) {
    // Create new store and write events
    const recoveryStore = await openJsonlStore({ baseDir: recoveryDir });

    // In a real scenario, you'd write these events to the new store
    console.log(`✓ Restored ${recoveredEvents.value.length} events from backup`);

    // Verify recovered data
    const recoveredIntegrity = verifyIntegrity(recoveredEvents.value);
    if (recoveredIntegrity.ok) {
      console.log(`✓ Recovered data integrity: ${recoveredIntegrity.value.healthy ? "HEALTHY" : "CORRUPTED"}`);
    }
  }

  console.log("\n✅ Backup & restore features demonstrated:");
  console.log("  ✓ Creating versioned backups");
  console.log("  ✓ JSON export/import");
  console.log("  ✓ JSONL compact format");
  console.log("  ✓ Backup validation");
  console.log("  ✓ Integrity verification");
  console.log("  ✓ Automatic data repair");
  console.log("  ✓ Disaster recovery workflow");

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
  await Deno.remove(recoveryDir, { recursive: true });
  console.log("\n✨ Example completed!");
}

if (import.meta.main) {
  main().catch(console.error);
}

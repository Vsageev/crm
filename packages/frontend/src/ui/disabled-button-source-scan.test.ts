import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

type JsxOpening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
type ReasonedBy = 'nearby validation/help text' | 'visible loading copy' | 'native boundary semantics' | 'explicit justified exemption';

interface DisabledButtonRecord {
  disabledExpression: string;
  file: string;
  line: number;
  tag: string;
  reasonedBy: string | null;
}

interface ApprovedException {
  disabledExpression: string;
  file: string;
  justification: string;
  line: number;
  reasonedBy: ReasonedBy;
  tag: 'button' | 'Button';
}

const thisFile = fileURLToPath(import.meta.url);
const srcRoot = path.resolve(path.dirname(thisFile), '..');
const workspaceRoot = path.resolve(srcRoot, '../../..');

const APPROVED_EXCEPTIONS: ApprovedException[] = [
  exception('packages/frontend/src/pages/DashboardPage.tsx', 499, 'button', 'refreshing', 'visible loading copy', 'Retry button changes to "Retrying..." while refresh is in flight.'),
  exception('packages/frontend/src/pages/DashboardPage.tsx', 628, 'button', 'inlineAddSubmitting', 'visible loading copy', 'Inline add button changes to "Adding..." while the card is being created.'),
  exception('packages/frontend/src/pages/DashboardPage.tsx', 812, 'button', 'convertingScratchpad', 'visible loading copy', 'Scratchpad action changes to "Converting..." while conversion is in flight.'),
  exception('packages/frontend/src/pages/collections/CollectionBatchRunPanel.tsx', 441, 'button', 'maxParallel <= 1', 'native boundary semantics', 'Numeric stepper decrement is disabled at the lower bound.'),
  exception('packages/frontend/src/pages/collections/CollectionBatchRunPanel.tsx', 451, 'button', 'maxParallel >= 10', 'native boundary semantics', 'Numeric stepper increment is disabled at the upper bound.'),
  exception('packages/frontend/src/pages/collections/CollectionDetailPage.tsx', 1254, 'button', '!savingViewName.trim()', 'nearby validation/help text', 'Save-view button sits beside the required view-name input.'),
  exception('packages/frontend/src/pages/collections/CollectionDetailPage.tsx', 1967, 'button', 'loadingMore', 'visible loading copy', 'Load-more button changes to "Loading..." while more cards load.'),
  exception('packages/frontend/src/pages/MyCardsPage.tsx', 733, 'button', 'bulkProcessing', 'explicit justified exemption', 'Short-lived bulk delete double-submit guard inside a selected-cards action bar.'),
  exception('packages/frontend/src/pages/boards/BoardBatchRunPanel.tsx', 554, 'button', 'maxParallel <= 1', 'native boundary semantics', 'Numeric stepper decrement is disabled at the lower bound.'),
  exception('packages/frontend/src/pages/boards/BoardBatchRunPanel.tsx', 564, 'button', 'maxParallel >= 10', 'native boundary semantics', 'Numeric stepper increment is disabled at the upper bound.'),
  exception('packages/frontend/src/pages/boards/CardQuickView.tsx', 594, 'button', '!hasPrev', 'native boundary semantics', 'Previous-card navigation is disabled at the first card.'),
  exception('packages/frontend/src/pages/boards/CardQuickView.tsx', 599, 'button', '!hasNext', 'native boundary semantics', 'Next-card navigation is disabled at the last card.'),
  exception('packages/frontend/src/pages/cards/CardDetailPage.tsx', 1203, 'button', '!prevCardId', 'native boundary semantics', 'Previous-card navigation is disabled at the first card.'),
  exception('packages/frontend/src/pages/cards/CardDetailPage.tsx', 1215, 'button', '!nextCardId', 'native boundary semantics', 'Next-card navigation is disabled at the last card.'),
  exception('packages/frontend/src/pages/AgentsPage.tsx', 1266, 'button', 'editingSubmitting', 'visible loading copy', 'Editing submit state is visible in the composer while attachment removal is paused.'),
  exception('packages/frontend/src/pages/AgentsPage.tsx', 1282, 'button', 'editingSubmitting', 'visible loading copy', 'Editing submit state is visible in the composer while attachment removal is paused.'),
  exception('packages/frontend/src/pages/AgentsPage.tsx', 1307, 'button', 'editingSubmitting', 'visible loading copy', 'Editing submit state is visible in the composer while attachment removal is paused.'),
  exception('packages/frontend/src/pages/AgentsPage.tsx', 1325, 'button', 'editingSubmitting', 'visible loading copy', 'Editing submit state is visible in the composer while attachment removal is paused.'),
  exception('packages/frontend/src/pages/AgentsPage.tsx', 1349, 'button', 'uploading', 'visible loading copy', 'Upload progress is visible in the composer while removal is paused.'),
  exception('packages/frontend/src/pages/AgentsPage.tsx', 1367, 'button', 'uploading', 'visible loading copy', 'Upload progress is visible in the composer while removal is paused.'),
  exception('packages/frontend/src/pages/AgentsPage.tsx', 6811, 'button', 'editingMessage?.isSubmitting', 'visible loading copy', 'Edit controls show the saving state while the edited message is submitting.'),
  exception('packages/frontend/src/pages/AgentsPage.tsx', 7552, 'Button', 'pickingPresetDirectoryKey !== null', 'visible loading copy', 'Directory picker button changes to "Choosing..." for the active preset directory.'),
  exception('packages/frontend/src/pages/AgentsPage.tsx', 7565, 'Button', 'pickingPresetDirectoryKey !== null', 'explicit justified exemption', 'Clear directory is disabled only while another directory picker operation owns the modal.'),
  exception('packages/frontend/src/pages/AgentsPage.tsx', 8870, 'button', 'renameConversationSaving', 'visible loading copy', 'Rename modal save button shows "Saving..." while close/cancel are paused.'),
  exception('packages/frontend/src/pages/AgentsPage.tsx', 8896, 'Button', 'renameConversationSaving', 'visible loading copy', 'Rename modal save button shows "Saving..." while cancel is paused.'),
  exception('packages/frontend/src/pages/AgentsPage.tsx', 8904, 'Button', 'renameConversationSaving || !renamingConversation.value.trim()', 'nearby validation/help text', 'Rename input is immediately above the submit button and save text changes to "Saving..." during submit.'),
  exception('packages/frontend/src/pages/auth/LoginPage.tsx', 72, 'Button', 'loading', 'visible loading copy', 'Login submit changes to "Signing in..." while authentication is in flight.'),
  exception('packages/frontend/src/pages/auth/RegisterPage.tsx', 202, 'Button', 'loading', 'visible loading copy', 'Register submit changes to "Creating account..." while registration is in flight.'),
  exception('packages/frontend/src/pages/settings/TagsTab.tsx', 114, 'button', 'Boolean(saveDisabledReason)', 'nearby validation/help text', 'Tag form renders the save blocker beside the edited fields.'),
  exception('packages/frontend/src/pages/settings/ProfileTab.tsx', 192, 'Button', '!profileDirty || savingProfile || !firstName.trim() || !lastName.trim()', 'nearby validation/help text', 'Profile form renders the save blocker beside the action.'),
  exception('packages/frontend/src/pages/settings/ProfileTab.tsx', 316, 'Button', 'changingPassword || !currentPassword || !newPassword || !confirmPassword', 'nearby validation/help text', 'Password form renders the change blocker beside the action.'),
  exception('packages/frontend/src/pages/settings/BackupsTab.tsx', 249, 'Button', 'restoreLoading', 'visible loading copy', 'Restore confirm action changes to "Restoring..." while restore is running.'),
  exception('packages/frontend/src/pages/settings/BackupsTab.tsx', 257, 'Button', 'restoreLoading', 'visible loading copy', 'Restore confirm action changes to "Restoring..." while cancel is paused.'),
  exception('packages/frontend/src/pages/settings/BackupsTab.tsx', 279, 'Button', 'deleteLoading', 'visible loading copy', 'Delete confirm action changes to "Deleting..." while deletion is running.'),
  exception('packages/frontend/src/pages/settings/BackupsTab.tsx', 287, 'Button', 'deleteLoading', 'visible loading copy', 'Delete confirm action changes to "Deleting..." while cancel is paused.'),
  exception('packages/frontend/src/pages/settings/ApiKeysTab.tsx', 417, 'Button', 'deleteLoading', 'visible loading copy', 'API key delete confirmation changes to "Deleting..." while deletion is running.'),
  exception('packages/frontend/src/pages/settings/ApiKeysTab.tsx', 425, 'Button', 'deleteLoading', 'visible loading copy', 'API key delete confirmation changes to "Deleting..." while cancel is paused.'),
  exception('packages/frontend/src/pages/settings/ApiKeysTab.tsx', 539, 'Button', 'saving', 'visible loading copy', 'API key form submit changes to "Saving..." while the key is saving.'),
  exception('packages/frontend/src/ui/WorkspaceModal.tsx', 188, 'Button', 'saving || nameMissing', 'nearby validation/help text', 'Workspace modal shows required-name help directly above the modal action.'),
  exception('packages/frontend/src/ui/CreateCardModal.tsx', 464, 'Button', 'uploadingDescriptionImages', 'visible loading copy', 'Description upload progress is visible while preview is paused.'),
  exception('packages/frontend/src/ui/ActionTooltip.tsx', 143, 'Button', 'useAriaDisabled ? false : disabled', 'explicit justified exemption', 'Shared helper implementation; the wrapper enforces the disabled reason contract.'),
  exception('packages/frontend/src/components/FileBrowser.tsx', 1059, 'button', 'uploading', 'visible loading copy', 'File upload control shows active upload state while the input trigger is disabled.'),
  exception('packages/frontend/src/components/ManualBatchCardSelector.tsx', 156, 'button', 'index === 0', 'native boundary semantics', 'Move-up reorder control is disabled at the first selected card.'),
  exception('packages/frontend/src/components/ManualBatchCardSelector.tsx', 165, 'button', 'index === selectedCards.length - 1', 'native boundary semantics', 'Move-down reorder control is disabled at the last selected card.'),
  exception('packages/frontend/src/components/FilePreviewModal.tsx', 220, 'Button', 'saving', 'visible loading copy', 'File preview footer shows "Saving..." while the extra footer action is paused.'),
  exception('packages/frontend/src/components/BatchLayerPlanner.tsx', 580, 'button', 'option.disabled', 'native boundary semantics', 'Dependency mode options are disabled when the mode cannot apply to that layer.'),
];

function exception(
  file: string,
  line: number,
  tag: 'button' | 'Button',
  disabledExpression: string,
  reasonedBy: ReasonedBy,
  justification: string,
): ApprovedException {
  return { disabledExpression, file, justification, line, reasonedBy, tag };
}

function readTsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return readTsxFiles(fullPath);
    if (!entry.endsWith('.tsx')) return [];
    if (entry.endsWith('.test.tsx')) return [];
    return [fullPath];
  });
}

function jsxNameToString(name: ts.JsxTagNameExpression): string {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isPropertyAccessExpression(name)) return name.name.text;
  if (ts.isJsxNamespacedName(name)) return name.name.text;
  return name.getText();
}

function getAttribute(opening: JsxOpening, name: string): ts.JsxAttribute | undefined {
  return opening.attributes.properties.find((property): property is ts.JsxAttribute => (
    ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name
  ));
}

function getDisabledExpression(attribute: ts.JsxAttribute, sourceFile: ts.SourceFile): string {
  if (!attribute.initializer) return 'true';
  if (ts.isJsxExpression(attribute.initializer)) {
    return (attribute.initializer.expression?.getText(sourceFile) ?? 'true').replace(/\s+/g, ' ');
  }
  return attribute.initializer.getText(sourceFile).replace(/\s+/g, ' ');
}

function isDisabledFalse(attribute: ts.JsxAttribute): boolean {
  return Boolean(
    attribute.initializer
      && ts.isJsxExpression(attribute.initializer)
      && attribute.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword,
  );
}

function findException(record: DisabledButtonRecord): ApprovedException | undefined {
  return APPROVED_EXCEPTIONS.find((approved) => (
    approved.file === record.file
      && approved.line === record.line
      && approved.tag === record.tag
      && approved.disabledExpression === record.disabledExpression
  ));
}

function scanDisabledButtons(): DisabledButtonRecord[] {
  const records: DisabledButtonRecord[] = [];

  for (const filePath of readTsxFiles(srcRoot)) {
    const sourceText = readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const file = path.relative(workspaceRoot, filePath).split(path.sep).join('/');
    const elementStack: JsxOpening[] = [];

    function visit(node: ts.Node): void {
      if (ts.isJsxElement(node)) {
        elementStack.push(node.openingElement);
        ts.forEachChild(node, visit);
        elementStack.pop();
        return;
      }

      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = jsxNameToString(node.tagName);
        const disabled = getAttribute(node, 'disabled');
        if (disabled && !isDisabledFalse(disabled) && (tag === 'button' || tag === 'Button' || tag === 'ReasonedActionButton')) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          const hasReasonedButtonReason = tag === 'ReasonedActionButton' && Boolean(getAttribute(node, 'disabledReason'));
          const actionTooltip = elementStack.find((element) => jsxNameToString(element.tagName) === 'ActionTooltip');
          const describedBy = getAttribute(node, 'aria-describedby');
          const disabledExpression = getDisabledExpression(disabled, sourceFile);
          records.push({
            disabledExpression,
            file,
            line,
            tag,
            reasonedBy: hasReasonedButtonReason
              ? 'hover/focus tooltip via ReasonedActionButton'
              : actionTooltip
                ? 'hover/focus tooltip via ActionTooltip'
                : describedBy
                  ? 'nearby validation/help text via aria-describedby'
                  : null,
          });
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return records.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function formatRecord(record: DisabledButtonRecord): string {
  const approved = findException(record);
  const reasonedBy = record.reasonedBy ?? approved?.reasonedBy ?? 'UNREASONED';
  const justification = approved ? ` - ${approved.justification}` : '';
  return `${record.file}:${record.line} <${record.tag}> disabled={${record.disabledExpression}} -> ${reasonedBy}${justification}`;
}

describe('disabled button source scan', () => {
  it('keeps conditional button disabled states reasoned or explicitly exempt', () => {
    const records = scanDisabledButtons();
    const unreasoned = records.filter((record) => !record.reasonedBy && !findException(record));
    const staleExceptions = APPROVED_EXCEPTIONS.filter((approved) => (
      !records.some((record) => (
        record.file === approved.file
          && record.line === approved.line
          && record.tag === approved.tag
          && record.disabledExpression === approved.disabledExpression
      ))
    ));

    expect(unreasoned.map(formatRecord)).toEqual([]);
    expect(staleExceptions.map((approved) => (
      `${approved.file}:${approved.line} <${approved.tag}> disabled={${approved.disabledExpression}}`
    ))).toEqual([]);
  });

  it('produces an auditable inventory for every remaining conditional disabled button', () => {
    const records = scanDisabledButtons();
    const inventory = records.map(formatRecord);

    expect(inventory.length).toBeGreaterThan(0);
    expect(inventory).toMatchInlineSnapshot(`
      [
        "packages/frontend/src/components/AgentAvatar.tsx:479 <button> disabled={undoStack.length === 0} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/components/AgentAvatar.tsx:489 <button> disabled={redoStack.length === 0} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/components/AgentAvatar.tsx:578 <button> disabled={saving} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/components/AgentAvatar.tsx:594 <button> disabled={!hasPixels || saving || !presetName.trim()} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/components/AgentAvatar.tsx:906 <button> disabled={renamingPresetId === preset.id || !editingPresetName.trim()} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/components/AgentAvatar.tsx:930 <button> disabled={deletingPresetId === preset.id} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/components/AgentAvatar.tsx:1053 <button> disabled={deletingColorPresetId === cp.id} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/components/AgentAvatar.tsx:1113 <button> disabled={savingColorPreset || !newColorPresetName.trim()} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/components/BatchLayerPlanner.tsx:580 <button> disabled={option.disabled} -> native boundary semantics - Dependency mode options are disabled when the mode cannot apply to that layer.",
        "packages/frontend/src/components/FileBrowser.tsx:1006 <ReasonedActionButton> disabled={Boolean(bulkDeleteDisabledReason)} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/components/FileBrowser.tsx:1059 <button> disabled={uploading} -> visible loading copy - File upload control shows active upload state while the input trigger is disabled.",
        "packages/frontend/src/components/FileBrowser.tsx:1084 <ReasonedActionButton> disabled={Boolean(uploadDisabledReason)} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/components/FileBrowser.tsx:1142 <ReasonedActionButton> disabled={Boolean(createFolderDisabledReason)} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/components/FileBrowser.tsx:1226 <button> disabled={Boolean(renameDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/components/FilePreviewModal.tsx:199 <ReasonedActionButton> disabled={saving} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/components/FilePreviewModal.tsx:209 <ReasonedActionButton> disabled={Boolean(saveDisabledReason)} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/components/FilePreviewModal.tsx:220 <Button> disabled={saving} -> visible loading copy - File preview footer shows "Saving..." while the extra footer action is paused.",
        "packages/frontend/src/components/FileSystemBrowserModal.tsx:237 <ReasonedActionButton> disabled={Boolean(selectDisabledReason)} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/components/ManualBatchCardSelector.tsx:156 <button> disabled={index === 0} -> native boundary semantics - Move-up reorder control is disabled at the first selected card.",
        "packages/frontend/src/components/ManualBatchCardSelector.tsx:165 <button> disabled={index === selectedCards.length - 1} -> native boundary semantics - Move-down reorder control is disabled at the last selected card.",
        "packages/frontend/src/pages/AgentMonitorPage.tsx:1521 <button> disabled={cleaningUp} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentMonitorPage.tsx:1603 <button> disabled={killingRunId === run.id} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentMonitorPage.tsx:1640 <button> disabled={cleaningBatch} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentMonitorPage.tsx:1698 <button> disabled={cancellingBatchId === batch.id} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:1239 <button> disabled={editingSubmitting} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:1266 <button> disabled={editingSubmitting} -> visible loading copy - Editing submit state is visible in the composer while attachment removal is paused.",
        "packages/frontend/src/pages/AgentsPage.tsx:1282 <button> disabled={editingSubmitting} -> visible loading copy - Editing submit state is visible in the composer while attachment removal is paused.",
        "packages/frontend/src/pages/AgentsPage.tsx:1307 <button> disabled={editingSubmitting} -> visible loading copy - Editing submit state is visible in the composer while attachment removal is paused.",
        "packages/frontend/src/pages/AgentsPage.tsx:1325 <button> disabled={editingSubmitting} -> visible loading copy - Editing submit state is visible in the composer while attachment removal is paused.",
        "packages/frontend/src/pages/AgentsPage.tsx:1349 <button> disabled={uploading} -> visible loading copy - Upload progress is visible in the composer while removal is paused.",
        "packages/frontend/src/pages/AgentsPage.tsx:1367 <button> disabled={uploading} -> visible loading copy - Upload progress is visible in the composer while removal is paused.",
        "packages/frontend/src/pages/AgentsPage.tsx:1404 <button> disabled={composerDisabled || uploading || editingSubmitting || (!isEditing && streaming) || attachmentLimitReached} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:1425 <button> disabled={composerDisabled || uploading || editingSubmitting || (!isEditing && streaming) || attachmentLimitReached} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:1484 <button> disabled={composerDisabled || uploading || editingSubmitting || (isEditing ? !canSubmitEdit : !composerValue.trim() && draftStagedAttachments.length === 0)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:6266 <ReasonedActionButton> disabled={!newGroupName.trim()} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/AgentsPage.tsx:6536 <button> disabled={visibleMessages.length === 0} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:6699 <button> disabled={(msg.siblingIndex ?? 0) === 0} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:6732 <button> disabled={(msg.siblingIndex ?? 0) >= (msg.siblingCount ?? 1) - 1} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:6811 <button> disabled={editingMessage?.isSubmitting} -> visible loading copy - Edit controls show the saving state while the edited message is submitting.",
        "packages/frontend/src/pages/AgentsPage.tsx:6866 <button> disabled={isTranscriptExecutionBusy || editingMessage?.isSubmitting} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:7094 <button> disabled={!activeConversationRun || stoppingRun} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:7216 <button> disabled={isQueuedItemBusy || editingMessage?.isSubmitting} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:7257 <button> disabled={isQueuedItemBusy || editingMessage?.isSubmitting} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:7552 <Button> disabled={pickingPresetDirectoryKey !== null} -> visible loading copy - Directory picker button changes to "Choosing..." for the active preset directory.",
        "packages/frontend/src/pages/AgentsPage.tsx:7565 <Button> disabled={pickingPresetDirectoryKey !== null} -> explicit justified exemption - Clear directory is disabled only while another directory picker operation owns the modal.",
        "packages/frontend/src/pages/AgentsPage.tsx:7830 <ReasonedActionButton> disabled={creating || cliMissing} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/AgentsPage.tsx:8172 <ReasonedActionButton> disabled={agentEnvVarFormOpen && !agentEnvVarForm.id} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/AgentsPage.tsx:8264 <ReasonedActionButton> disabled={agentEnvVarSaving} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/AgentsPage.tsx:8377 <button> disabled={cronSaving} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:8411 <button> disabled={cronSaving} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:8455 <ReasonedActionButton> disabled={!cronFormCron.trim() || !cronFormPrompt.trim() || cronSaving} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/AgentsPage.tsx:8700 <button> disabled={!mgrFormName.trim() || !mgrHasDirtyForm || mgrSaving} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:8766 <button> disabled={!mgrFormName.trim() || mgrSaving} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/AgentsPage.tsx:8870 <button> disabled={renameConversationSaving} -> visible loading copy - Rename modal save button shows "Saving..." while close/cancel are paused.",
        "packages/frontend/src/pages/AgentsPage.tsx:8896 <Button> disabled={renameConversationSaving} -> visible loading copy - Rename modal save button shows "Saving..." while cancel is paused.",
        "packages/frontend/src/pages/AgentsPage.tsx:8904 <Button> disabled={renameConversationSaving || !renamingConversation.value.trim()} -> nearby validation/help text - Rename input is immediately above the submit button and save text changes to "Saving..." during submit.",
        "packages/frontend/src/pages/auth/LoginPage.tsx:72 <Button> disabled={loading} -> visible loading copy - Login submit changes to "Signing in..." while authentication is in flight.",
        "packages/frontend/src/pages/auth/RegisterPage.tsx:202 <Button> disabled={loading} -> visible loading copy - Register submit changes to "Creating account..." while registration is in flight.",
        "packages/frontend/src/pages/boards/BoardBatchRunPanel.tsx:554 <button> disabled={maxParallel <= 1} -> native boundary semantics - Numeric stepper decrement is disabled at the lower bound.",
        "packages/frontend/src/pages/boards/BoardBatchRunPanel.tsx:564 <button> disabled={maxParallel >= 10} -> native boundary semantics - Numeric stepper increment is disabled at the upper bound.",
        "packages/frontend/src/pages/boards/BoardBatchRunPanel.tsx:607 <ReasonedActionButton> disabled={Boolean(disabledReason)} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/boards/BoardCronTemplatesPanel.tsx:332 <ReasonedActionButton> disabled={submitting || !formName.trim()} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/boards/BoardExecutionPlansPanel.tsx:450 <button> disabled={!canRun} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/boards/BoardExecutionPlansPanel.tsx:527 <ReasonedActionButton> disabled={!canRunEditingPlan} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/boards/BoardExecutionPlansPanel.tsx:537 <ReasonedActionButton> disabled={!canSave} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/boards/BoardPage.tsx:1561 <button> disabled={board.cards.length === 0 || clearingBoardCards} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/boards/BoardPage.tsx:1577 <button> disabled={deletingBoard} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/boards/BoardPage.tsx:1864 <ReasonedActionButton> disabled={creatingBoard || !newBoardName.trim()} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/boards/BoardPage.tsx:2501 <button> disabled={agents.length === 0} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/boards/BoardPage.tsx:2554 <button> disabled={!agentPromptDirty} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/boards/BoardPage.tsx:2692 <button> disabled={cards.length === 0 || columnActionBusy} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/boards/BoardPage.tsx:2715 <button> disabled={cards.length === 0 || columnActionBusy} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/boards/BoardPage.tsx:2940 <button> disabled={inlineSubmitting} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/boards/BoardPage.tsx:3073 <button> disabled={!inlineName.trim() || inlineSubmitting} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/boards/BoardPage.tsx:3256 <ReasonedActionButton> disabled={!name.trim()} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/boards/BoardsListPage.tsx:457 <button> disabled={deletingBoardId === board.id} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/boards/BoardsListPage.tsx:502 <ReasonedActionButton> disabled={creating || !createName.trim()} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/boards/CardQuickView.tsx:594 <button> disabled={!hasPrev} -> native boundary semantics - Previous-card navigation is disabled at the first card.",
        "packages/frontend/src/pages/boards/CardQuickView.tsx:599 <button> disabled={!hasNext} -> native boundary semantics - Next-card navigation is disabled at the last card.",
        "packages/frontend/src/pages/boards/CardQuickView.tsx:656 <button> disabled={savingTitle || !titleDraft.trim()} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/boards/CardQuickView.tsx:820 <button> disabled={savingDesc || uploadingDescImages} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/boards/CardQuickView.tsx:830 <ReasonedActionButton> disabled={savingDesc || uploadingDescImages} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/boards/CardQuickView.tsx:839 <ReasonedActionButton> disabled={savingDesc || uploadingDescImages} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/boards/CardQuickView.tsx:983 <ReasonedActionButton> disabled={savingEditComment} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/boards/CardQuickView.tsx:992 <ReasonedActionButton> disabled={!editCommentDraft.trim() || savingEditComment} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/boards/CardQuickView.tsx:1076 <button> disabled={uploadingImages || stagedImages.length >= MAX_COMMENT_IMAGES} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/boards/CardQuickView.tsx:1108 <button> disabled={(!newComment.trim() && stagedImages.length === 0) || submitting} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/cards/CardDetailPage.tsx:1203 <button> disabled={!prevCardId} -> native boundary semantics - Previous-card navigation is disabled at the first card.",
        "packages/frontend/src/pages/cards/CardDetailPage.tsx:1215 <button> disabled={!nextCardId} -> native boundary semantics - Next-card navigation is disabled at the last card.",
        "packages/frontend/src/pages/cards/CardDetailPage.tsx:1333 <button> disabled={uploadingDescImages} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/cards/CardDetailPage.tsx:1511 <ReasonedActionButton> disabled={!editCommentDraft.trim() || savingEditComment} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/cards/CardDetailPage.tsx:1588 <button> disabled={uploadingImages || stagedImages.length >= MAX_COMMENT_IMAGES} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/cards/CardDetailPage.tsx:1620 <button> disabled={(!newComment.trim() && stagedImages.length === 0) || submittingComment} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/cards/CardDetailPage.tsx:1671 <button> disabled={col.id === card.collectionId || movingCollection} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/cards/CardDetailPage.tsx:1855 <button> disabled={!newTagName.trim() || creatingTag} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/cards/CardDetailPage.tsx:1875 <button> disabled={tagIds.has(tag.id)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/cards/CardDetailPage.tsx:1889 <button> disabled={deletingTagId === tag.id} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/cards/CardDetailPage.tsx:2025 <button> disabled={savingCf} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/cards/CardDetailPage.tsx:2069 <button> disabled={!newCfKey.trim() || savingCf} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/collections/CollectionBatchRunPanel.tsx:441 <button> disabled={maxParallel <= 1} -> native boundary semantics - Numeric stepper decrement is disabled at the lower bound.",
        "packages/frontend/src/pages/collections/CollectionBatchRunPanel.tsx:451 <button> disabled={maxParallel >= 10} -> native boundary semantics - Numeric stepper increment is disabled at the upper bound.",
        "packages/frontend/src/pages/collections/CollectionBatchRunPanel.tsx:498 <button> disabled={saving} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/collections/CollectionBatchRunPanel.tsx:509 <ReasonedActionButton> disabled={Boolean(disabledReason)} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/collections/CollectionDetailPage.tsx:1098 <ReasonedActionButton> disabled={deletingCollection} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/collections/CollectionDetailPage.tsx:1108 <ReasonedActionButton> disabled={exporting || sortedCards.length === 0} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/collections/CollectionDetailPage.tsx:1254 <button> disabled={!savingViewName.trim()} -> nearby validation/help text - Save-view button sits beside the required view-name input.",
        "packages/frontend/src/pages/collections/CollectionDetailPage.tsx:1967 <button> disabled={loadingMore} -> visible loading copy - Load-more button changes to "Loading..." while more cards load.",
        "packages/frontend/src/pages/collections/CollectionDetailPage.tsx:2024 <ReasonedActionButton> disabled={creatingCollection || !newCollectionName.trim()} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/collections/CollectionsListPage.tsx:332 <button> disabled={deletingCollectionId === collection.id} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/collections/CollectionsListPage.tsx:376 <ReasonedActionButton> disabled={creating || !createName.trim()} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/DashboardPage.tsx:465 <button> disabled={Boolean(refreshDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/DashboardPage.tsx:499 <button> disabled={refreshing} -> visible loading copy - Retry button changes to "Retrying..." while refresh is in flight.",
        "packages/frontend/src/pages/DashboardPage.tsx:628 <button> disabled={inlineAddSubmitting} -> visible loading copy - Inline add button changes to "Adding..." while the card is being created.",
        "packages/frontend/src/pages/DashboardPage.tsx:812 <button> disabled={convertingScratchpad} -> visible loading copy - Scratchpad action changes to "Converting..." while conversion is in flight.",
        "packages/frontend/src/pages/inbox/InboxPage.tsx:1015 <button> disabled={Boolean(bulkActionDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/inbox/InboxPage.tsx:1024 <button> disabled={Boolean(bulkActionDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/inbox/InboxPage.tsx:1033 <button> disabled={Boolean(bulkActionDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/inbox/InboxPage.tsx:1042 <button> disabled={Boolean(bulkActionDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/inbox/InboxPage.tsx:1051 <button> disabled={Boolean(bulkActionDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/inbox/InboxPage.tsx:1069 <button> disabled={Boolean(markAllReadDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/inbox/InboxPage.tsx:1736 <button> disabled={Boolean(sendDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/MyCardsPage.tsx:733 <button> disabled={bulkProcessing} -> explicit justified exemption - Short-lived bulk delete double-submit guard inside a selected-cards action bar.",
        "packages/frontend/src/pages/settings/ActivityLogTab.tsx:340 <button> disabled={Boolean(loadMoreDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/settings/ApiKeysTab.tsx:345 <ReasonedActionButton> disabled={Boolean(saveDefaultDisabledReason)} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/settings/ApiKeysTab.tsx:417 <Button> disabled={deleteLoading} -> visible loading copy - API key delete confirmation changes to "Deleting..." while deletion is running.",
        "packages/frontend/src/pages/settings/ApiKeysTab.tsx:425 <Button> disabled={deleteLoading} -> visible loading copy - API key delete confirmation changes to "Deleting..." while cancel is paused.",
        "packages/frontend/src/pages/settings/ApiKeysTab.tsx:539 <Button> disabled={saving} -> visible loading copy - API key form submit changes to "Saving..." while the key is saving.",
        "packages/frontend/src/pages/settings/BackupsTab.tsx:179 <ReasonedActionButton> disabled={Boolean(importDisabledReason)} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/settings/BackupsTab.tsx:189 <ReasonedActionButton> disabled={Boolean(createDisabledReason)} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/settings/BackupsTab.tsx:216 <ReasonedActionButton> disabled={Boolean(createDisabledReason)} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/settings/BackupsTab.tsx:249 <Button> disabled={restoreLoading} -> visible loading copy - Restore confirm action changes to "Restoring..." while restore is running.",
        "packages/frontend/src/pages/settings/BackupsTab.tsx:257 <Button> disabled={restoreLoading} -> visible loading copy - Restore confirm action changes to "Restoring..." while cancel is paused.",
        "packages/frontend/src/pages/settings/BackupsTab.tsx:279 <Button> disabled={deleteLoading} -> visible loading copy - Delete confirm action changes to "Deleting..." while deletion is running.",
        "packages/frontend/src/pages/settings/BackupsTab.tsx:287 <Button> disabled={deleteLoading} -> visible loading copy - Delete confirm action changes to "Deleting..." while cancel is paused.",
        "packages/frontend/src/pages/settings/ChatTab.tsx:113 <button> disabled={Boolean(saveDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/settings/FallbackModelTab.tsx:205 <button> disabled={Boolean(clearDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/settings/FallbackModelTab.tsx:219 <button> disabled={Boolean(saveDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/settings/ProfileTab.tsx:192 <Button> disabled={!profileDirty || savingProfile || !firstName.trim() || !lastName.trim()} -> nearby validation/help text - Profile form renders the save blocker beside the action.",
        "packages/frontend/src/pages/settings/ProfileTab.tsx:316 <Button> disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword} -> nearby validation/help text - Password form renders the change blocker beside the action.",
        "packages/frontend/src/pages/settings/RateLimitsTab.tsx:122 <button> disabled={Boolean(saveDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/settings/RunnerDevicesTab.tsx:169 <ReasonedActionButton> disabled={Boolean(connectDisabledReason)} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/pages/settings/RunnerDevicesTab.tsx:241 <button> disabled={Boolean(renameDisabledReason)} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/settings/RunnerDevicesTab.tsx:260 <button> disabled={device.revoked} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/settings/RunnerDevicesTab.tsx:278 <button> disabled={device.revoked} -> hover/focus tooltip via ActionTooltip",
        "packages/frontend/src/pages/settings/TagsTab.tsx:114 <button> disabled={Boolean(saveDisabledReason)} -> nearby validation/help text - Tag form renders the save blocker beside the edited fields.",
        "packages/frontend/src/ui/ActionTooltip.tsx:143 <Button> disabled={useAriaDisabled ? false : disabled} -> explicit justified exemption - Shared helper implementation; the wrapper enforces the disabled reason contract.",
        "packages/frontend/src/ui/CreateCardModal.tsx:464 <Button> disabled={uploadingDescriptionImages} -> visible loading copy - Description upload progress is visible while preview is paused.",
        "packages/frontend/src/ui/CreateCardModal.tsx:679 <ReasonedActionButton> disabled={!canSubmit} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/ui/CreateCardModal.tsx:688 <ReasonedActionButton> disabled={!canSubmit} -> hover/focus tooltip via ReasonedActionButton",
        "packages/frontend/src/ui/WorkspaceModal.tsx:188 <Button> disabled={saving || nameMissing} -> nearby validation/help text - Workspace modal shows required-name help directly above the modal action.",
      ]
    `);
  });
});

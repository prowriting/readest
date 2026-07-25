import { expect, test } from '../fixtures/base';

test.describe('Annotation', () => {
  test('shows the annotation popup when text is selected', async ({ openBook }) => {
    const reader = await openBook();

    await reader.selectText();

    await expect(reader.annotationPopup).toBeVisible();
    await expect(reader.popupTool('Highlight')).toBeVisible();
    await expect(reader.conceptChips.getByRole('button', { name: 'Useful' })).toBeVisible();
  });

  test('creates a highlight from the selected text', async ({ openBook }) => {
    const reader = await openBook();

    await reader.selectText();
    await reader.highlightSelection();

    await reader.openAnnotationsTab();
    await expect(reader.annotationItems).toHaveCount(1);
  });

  test('applies a non-thought concept highlight without prompting for a note', async ({
    openBook,
  }) => {
    const reader = await openBook();

    await reader.selectText();
    await reader.selectConcept('Useful');

    // No thought sheet for concepts other than Thought.
    await expect(reader.thoughtSheet).toBeHidden();

    await reader.openAnnotationsTab();
    await expect(reader.annotationItems).toHaveCount(1);
  });

  test('opens the sheet and saves a thought only for the Thought concept', async ({ openBook }) => {
    const reader = await openBook();
    const thought = 'A thought added by the e2e suite';

    await reader.selectText();
    await reader.selectThoughtConcept();
    await reader.saveThought(thought);

    await reader.openAnnotationsTab();
    await expect(reader.sidebar.getByText(thought)).toBeVisible();
  });

  test('adds a note to the selected text', async ({ openBook }) => {
    const reader = await openBook();
    const noteText = 'A note added by the e2e suite';

    await reader.selectText();
    await reader.addNote(noteText);

    await expect(reader.notebook.getByText(noteText)).toBeVisible();
  });

  test('deletes an annotation', async ({ openBook }) => {
    const reader = await openBook();

    await reader.selectText();
    await reader.highlightSelection();
    await reader.openAnnotationsTab();
    await expect(reader.annotationItems).toHaveCount(1);

    await reader.deleteFirstAnnotation();

    await expect(reader.annotationItems).toHaveCount(0);
  });
});

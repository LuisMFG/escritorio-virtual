using Microsoft.VisualStudio.Extensibility;
using Microsoft.VisualStudio.Extensibility.Editor;

namespace EscritorioAtividade;

/// <summary>Ouve o editor: abrir, trocar de arquivo e digitar contam como "mexendo no código".</summary>
[VisualStudioContribution]
internal sealed class TypingListener : ExtensionPart, ITextViewOpenClosedListener, ITextViewChangedListener
{
    private readonly ActivityReporter reporter;

    public TypingListener(ActivityReporter reporter)
    {
        this.reporter = reporter;
    }

    public TextViewExtensionConfiguration TextViewExtensionConfiguration => new()
    {
        AppliesTo = [DocumentFilter.FromDocumentType(DocumentType.KnownValues.Code)],
    };

    public Task TextViewChangedAsync(TextViewChangedArgs args, CancellationToken cancellationToken)
    {
        this.reporter.Touch(args.AfterTextView.FilePath);
        return Task.CompletedTask;
    }

    public Task TextViewOpenedAsync(ITextViewSnapshot textView, CancellationToken cancellationToken)
    {
        this.reporter.Touch(textView.FilePath);
        return Task.CompletedTask;
    }

    public Task TextViewClosedAsync(ITextViewSnapshot textView, CancellationToken cancellationToken) =>
        Task.CompletedTask;
}

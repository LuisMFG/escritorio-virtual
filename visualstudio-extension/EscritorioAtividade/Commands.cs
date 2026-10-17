using Microsoft.VisualStudio.Extensibility;
using Microsoft.VisualStudio.Extensibility.Commands;
using Microsoft.VisualStudio.Extensibility.Shell;

namespace EscritorioAtividade;

/// <summary>Extensões → "Escritório: conectar": pede o endereço e o token pessoal.</summary>
[VisualStudioContribution]
internal sealed class ConnectCommand : Command
{
    private readonly ActivityReporter reporter;

    public ConnectCommand(ActivityReporter reporter)
    {
        this.reporter = reporter;
    }

    public override CommandConfiguration CommandConfiguration => new("%EscritorioAtividade.Connect.DisplayName%")
    {
        Placements = [CommandPlacement.KnownPlacements.ExtensionsMenu],
    };

    public override async Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
    {
        var shell = this.Extensibility.Shell();
        var url = await shell.ShowPromptAsync(
            "Endereço do Escritório Virtual (o mesmo que você abre no navegador):",
            new InputPromptOptions { DefaultText = this.reporter.ServerUrl is { Length: > 0 } s ? s : "http://localhost:2567" },
            cancellationToken);
        if (string.IsNullOrWhiteSpace(url)) return;
        if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
        {
            await shell.ShowPromptAsync("Endereço inválido: use http:// ou https://.", PromptOptions.OK, cancellationToken);
            return;
        }

        var token = await shell.ShowPromptAsync(
            "Token pessoal (gere no seu Perfil do escritório, seção “Editores de código”):",
            new InputPromptOptions(),
            cancellationToken);
        if (string.IsNullOrWhiteSpace(token)) return;
        if (!token.Trim().StartsWith("esc_", StringComparison.Ordinal))
        {
            await shell.ShowPromptAsync("O token começa com esc_. Copie de novo do Perfil.", PromptOptions.OK, cancellationToken);
            return;
        }

        this.reporter.Connect(url, token);
        await shell.ShowPromptAsync(
            "Escritório Virtual conectado. Quando você programar, o escritório mostra no seu cartão.",
            PromptOptions.OK,
            cancellationToken);
    }
}

/// <summary>Extensões → "Escritório: pausar ou retomar".</summary>
[VisualStudioContribution]
internal sealed class TogglePauseCommand : Command
{
    private readonly ActivityReporter reporter;

    public TogglePauseCommand(ActivityReporter reporter)
    {
        this.reporter = reporter;
    }

    public override CommandConfiguration CommandConfiguration => new("%EscritorioAtividade.TogglePause.DisplayName%")
    {
        Placements = [CommandPlacement.KnownPlacements.ExtensionsMenu],
    };

    public override async Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
    {
        var paused = this.reporter.TogglePause();
        var status = paused
            ? "Pausado: nada é enviado ao escritório."
            : this.reporter.IsConfigured
                ? "Retomado: o escritório volta a ver quando você programa."
                : "Ainda não conectado. Use “Escritório: conectar”.";
        if (!paused && this.reporter.LastError is { } error) status += $"\nÚltimo erro ao enviar: {error}.";
        await this.Extensibility.Shell().ShowPromptAsync(status, PromptOptions.OK, cancellationToken);
    }
}

/// <summary>Extensões → "Escritório: desconectar".</summary>
[VisualStudioContribution]
internal sealed class DisconnectCommand : Command
{
    private readonly ActivityReporter reporter;

    public DisconnectCommand(ActivityReporter reporter)
    {
        this.reporter = reporter;
    }

    public override CommandConfiguration CommandConfiguration => new("%EscritorioAtividade.Disconnect.DisplayName%")
    {
        Placements = [CommandPlacement.KnownPlacements.ExtensionsMenu],
    };

    public override async Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
    {
        this.reporter.Disconnect();
        await this.Extensibility.Shell().ShowPromptAsync(
            "Desconectado. O token foi apagado deste computador.", PromptOptions.OK, cancellationToken);
    }
}

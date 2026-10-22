using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.Extensibility;

namespace EscritorioAtividade;

/// <summary>
/// Extensão "Escritório Virtual — Atividade" para o Visual Studio: mostra no escritório quando a
/// pessoa está programando (linguagem e projeto, conforme a privacidade escolhida no Perfil).
/// </summary>
[VisualStudioContribution]
internal class ExtensionEntrypoint : Extension
{
    public override ExtensionConfiguration ExtensionConfiguration => new()
    {
        Metadata = new(
            id: "EscritorioAtividade.6f1d2c3a-4b5e-4f70-9a81-2c3d4e5f6a7b",
            version: this.ExtensionAssemblyVersion,
            publisherName: "Escritório Virtual",
            displayName: "Escritório Virtual — Atividade",
            description: "Mostra no Escritório Virtual quando você está programando no Visual Studio."),
    };

    protected override void InitializeServices(IServiceCollection serviceCollection)
    {
        base.InitializeServices(serviceCollection);
        serviceCollection.AddSingleton<ActivityReporter>();
    }
}

using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;

namespace EscritorioAtividade;

/// <summary>
/// Guarda a configuração, decide quando mandar sinal (<see cref="ActivityTracker"/>) e envia ao
/// escritório (<c>POST /api/activity/editor</c> com o token pessoal).
/// </summary>
internal sealed class ActivityReporter : IDisposable
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };

    private static readonly Dictionary<string, string> Languages = new(StringComparer.OrdinalIgnoreCase)
    {
        [".cs"] = "csharp",
        [".vb"] = "basic",
        [".fs"] = "fsharp",
        [".cpp"] = "cpp",
        [".cc"] = "cpp",
        [".h"] = "cpp",
        [".hpp"] = "cpp",
        [".c"] = "c",
        [".ts"] = "typescript",
        [".tsx"] = "typescript",
        [".js"] = "javascript",
        [".jsx"] = "javascript",
        [".razor"] = "razor",
        [".cshtml"] = "razor",
        [".xaml"] = "xaml",
        [".sql"] = "sql",
        [".json"] = "json",
        [".xml"] = "xml",
        [".py"] = "python",
        [".css"] = "css",
        [".scss"] = "scss",
        [".html"] = "html",
        [".ps1"] = "powershell",
        [".md"] = "markdown",
        [".yml"] = "yaml",
        [".yaml"] = "yaml",
    };

    private readonly ActivityTracker tracker;
    private readonly Timer timer;
    private readonly ConcurrentDictionary<string, string?> projectByFolder = new();
    private Settings settings = Settings.Load();

    public ActivityReporter()
    {
        this.tracker = new ActivityTracker(hb => _ = this.SendAsync(hb));
        this.timer = new Timer(_ => this.tracker.Tick(), null, TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(15));
    }

    /// <summary>Último problema ao enviar (para mostrar no comando "conectar").</summary>
    public string? LastError { get; private set; }

    public bool IsConfigured => !string.IsNullOrEmpty(this.settings.ServerUrl) && this.settings.Token is not null;

    public bool IsPaused => this.settings.Paused;

    public string ServerUrl => this.settings.ServerUrl;

    /// <summary>A pessoa mexeu num arquivo (digitou, abriu, trocou de aba).</summary>
    public void Touch(string? filePath)
    {
        if (this.settings.Paused || !this.IsConfigured || string.IsNullOrEmpty(filePath)) return;
        var language = Languages.TryGetValue(Path.GetExtension(filePath), out var id) ? id : null;
        this.tracker.Touch(language, this.ProjectOf(filePath));
    }

    public void Connect(string serverUrl, string token)
    {
        this.settings.ServerUrl = serverUrl.Trim().TrimEnd('/');
        this.settings.Token = token.Trim();
        this.settings.Paused = false;
        this.settings.Save();
        this.LastError = null;
    }

    public void Disconnect()
    {
        this.tracker.Stop();
        this.settings = new Settings();
        this.settings.Save();
    }

    /// <summary>Pausa ou retoma; devolve se ficou pausado.</summary>
    public bool TogglePause()
    {
        this.settings.Paused = !this.settings.Paused;
        this.settings.Save();
        if (this.settings.Paused) this.tracker.Stop();
        return this.settings.Paused;
    }

    public void Dispose()
    {
        this.timer.Dispose();
        this.tracker.Stop();
    }

    /// <summary>Nome da solução (.sln/.slnx) ou do projeto (.csproj…) mais próximo do arquivo.</summary>
    private string? ProjectOf(string filePath)
    {
        var folder = Path.GetDirectoryName(filePath);
        if (folder is null) return null;
        return this.projectByFolder.GetOrAdd(folder, static start =>
        {
            string? project = null;
            for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
            {
                try
                {
                    var sln = dir.EnumerateFiles("*.sln").Concat(dir.EnumerateFiles("*.slnx")).FirstOrDefault();
                    if (sln is not null) return Path.GetFileNameWithoutExtension(sln.Name);
                    project ??= dir.EnumerateFiles("*.*proj").Select(f => Path.GetFileNameWithoutExtension(f.Name)).FirstOrDefault();
                }
                catch (Exception)
                {
                    break;
                }
            }

            return project;
        });
    }

    private async Task SendAsync(Heartbeat hb)
    {
        var token = this.settings.Token;
        if (string.IsNullOrEmpty(this.settings.ServerUrl) || token is null) return;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{this.settings.ServerUrl}/api/activity/editor")
            {
                Content = JsonContent.Create(new
                {
                    editor = "visualstudio",
                    state = hb.State,
                    language = hb.Language,
                    project = hb.Project,
                }),
            };
            request.Headers.Authorization = new("Bearer", token);
            using var response = await Http.SendAsync(request).ConfigureAwait(false);
            if (response.StatusCode == HttpStatusCode.Unauthorized)
            {
                this.LastError = "token inválido ou revogado";
                this.Disconnect();
                return;
            }

            this.LastError = response.IsSuccessStatusCode ? null : $"HTTP {(int)response.StatusCode}";
        }
        catch (Exception ex)
        {
            this.LastError = ex.Message;
        }
    }
}

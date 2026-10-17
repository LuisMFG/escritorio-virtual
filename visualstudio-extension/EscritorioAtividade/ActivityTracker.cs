namespace EscritorioAtividade;

/// <summary>Sinal mandado ao escritório (mesmo formato da extensão do VS Code).</summary>
internal sealed record Heartbeat(string State, string? Language = null, string? Project = null);

/// <summary>
/// Regras de quando mandar sinal (iguais às do VS Code): mexeu no código = ativo; ativo manda um
/// sinal por minuto, ou na hora se a linguagem/projeto mudar; 5 minutos parado manda "ocioso".
/// </summary>
internal sealed class ActivityTracker
{
    public static readonly TimeSpan HeartbeatEvery = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan IdleAfter = TimeSpan.FromMinutes(5);

    private readonly Action<Heartbeat> send;
    private readonly Func<DateTime> now;
    private readonly object gate = new();
    private DateTime lastTouch = DateTime.MinValue;
    private DateTime lastSent = DateTime.MinValue;
    private string sentKey = string.Empty;
    private bool active;
    private string? language;
    private string? project;

    public ActivityTracker(Action<Heartbeat> send, Func<DateTime>? now = null)
    {
        this.send = send;
        this.now = now ?? (() => DateTime.UtcNow);
    }

    public void Touch(string? language, string? project)
    {
        lock (this.gate)
        {
            this.language = language;
            this.project = project;
            this.lastTouch = this.now();
        }

        this.Tick();
    }

    public void Tick()
    {
        Heartbeat? hb = null;
        lock (this.gate)
        {
            var now = this.now();
            if (now - this.lastTouch >= IdleAfter)
            {
                if (this.active)
                {
                    this.active = false;
                    this.sentKey = string.Empty;
                    hb = new Heartbeat("idle");
                }
            }
            else
            {
                var key = $"{this.language}|{this.project}";
                if (!this.active || key != this.sentKey || now - this.lastSent >= HeartbeatEvery)
                {
                    this.active = true;
                    this.sentKey = key;
                    this.lastSent = now;
                    hb = new Heartbeat("active", this.language, this.project);
                }
            }
        }

        if (hb is not null) this.send(hb);
    }

    public void Stop()
    {
        bool wasActive;
        lock (this.gate)
        {
            wasActive = this.active;
            this.active = false;
            this.sentKey = string.Empty;
            this.lastTouch = DateTime.MinValue;
        }

        if (wasActive) this.send(new Heartbeat("closed"));
    }
}

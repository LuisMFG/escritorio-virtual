using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace EscritorioAtividade;

/// <summary>
/// Endereço do escritório e token pessoal, em %APPDATA%\EscritorioVirtual\atividade.json.
/// O token fica criptografado para o usuário do Windows (DPAPI).
/// </summary>
internal sealed class Settings
{
    public string ServerUrl { get; set; } = string.Empty;

    public string ProtectedToken { get; set; } = string.Empty;

    public bool Paused { get; set; }

    private static string FilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "EscritorioVirtual",
        "atividade.json");

    public string? Token
    {
        get
        {
            if (string.IsNullOrEmpty(this.ProtectedToken)) return null;
            try
            {
                var bytes = ProtectedData.Unprotect(
                    Convert.FromBase64String(this.ProtectedToken), null, DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(bytes);
            }
            catch (CryptographicException)
            {
                return null;
            }
        }

        set
        {
            this.ProtectedToken = string.IsNullOrEmpty(value)
                ? string.Empty
                : Convert.ToBase64String(ProtectedData.Protect(
                    Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser));
        }
    }

    public static Settings Load()
    {
        try
        {
            return File.Exists(FilePath)
                ? JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath)) ?? new Settings()
                : new Settings();
        }
        catch (Exception)
        {
            return new Settings();
        }
    }

    public void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this));
    }
}

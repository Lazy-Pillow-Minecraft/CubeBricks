using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class CubeBricksStart
{
    [STAThread]
    private static void Main(string[] arguments)
    {
        string root = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
        string electron = Path.Combine(root, "node_modules", "electron", "dist", "electron.exe");
        if (!File.Exists(electron))
        {
            MessageBox.Show("找不到開發版 Electron。請先在此項目目錄執行 npm install。", "CubeBricks",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        try
        {
            var command = new StringBuilder(Quote(root));
            foreach (string argument in arguments) command.Append(' ').Append(Quote(argument));
            Process.Start(new ProcessStartInfo
            {
                FileName = electron,
                Arguments = command.ToString(),
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });
        }
        catch (Exception error)
        {
            MessageBox.Show("CubeBricks 啟動失敗：\n" + error.Message, "CubeBricks",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"')
            {
                result.Append('\\', slashes * 2 + 1).Append('"');
                slashes = 0;
                continue;
            }
            result.Append('\\', slashes).Append(character);
            slashes = 0;
        }
        result.Append('\\', slashes * 2).Append('"');
        return result.ToString();
    }
}

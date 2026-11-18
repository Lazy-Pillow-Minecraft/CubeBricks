using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("CubeBricks")]
[assembly: AssemblyProduct("CubeBricks")]
[assembly: AssemblyCompany("CubeBricks")]

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
            string executable = electron;
            try
            {
                using (var prepare = Process.Start(new ProcessStartInfo
                {
                    FileName = "node.exe",
                    Arguments = Quote(Path.Combine(root, "scripts", "start-desktop.cjs")) + " --prepare-runtime",
                    WorkingDirectory = root,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true
                }))
                {
                    string path = prepare.StandardOutput.ReadToEnd().Trim();
                    prepare.WaitForExit();
                    if (prepare.ExitCode == 0 && File.Exists(path)) executable = path;
                }
            }
            catch (Exception)
            {
                // The dependency can still launch directly if branding setup is unavailable.
            }
            var command = new StringBuilder(Quote(root));
            foreach (string argument in arguments)
            {
                command.Append(' ').Append(Quote(argument));
            }
            if (executable != electron)
            {
                try
                {
                    using (var startup = StartEditor(executable, command.ToString(), root))
                    {
                        if (!startup.WaitForExit(4000) || startup.ExitCode == 0) return;
                    }
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    // Retry the installed development runtime if Windows rejects the copy.
                }
            }
            using (var startup = StartEditor(electron, command.ToString(), root))
            {
                if (startup.WaitForExit(4000) && startup.ExitCode != 0)
                    throw new InvalidOperationException("Electron 在啟動時退出（" + startup.ExitCode + "）。");
            }
        }
        catch (Exception error)
        {
            MessageBox.Show("CubeBricks 啟動失敗：\n" + error.Message, "CubeBricks",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static Process StartEditor(string executable, string arguments, string root)
    {
        return Process.Start(new ProcessStartInfo
            {
                FileName = executable,
                Arguments = arguments,
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });
    }

    private static string Quote(string value)
    {
        // Windows interprets runs of backslashes differently before a quote.
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                slashes++;
                continue;
            }
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

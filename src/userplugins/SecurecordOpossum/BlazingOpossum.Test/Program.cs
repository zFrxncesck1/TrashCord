using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

public class Program
{
    public static void Main()
    {
        byte[] key = new byte[32];
        byte[] iv = new byte[16];

        RandomNumberGenerator.Fill(key);
        RandomNumberGenerator.Fill(iv);

        byte[] plainText = Encoding.UTF8.GetBytes("The BlazingOpossum algorithm is working!");
        Console.WriteLine($"Plain text (Plain): {Encoding.UTF8.GetString(plainText)}");
        Console.WriteLine($"Plain text (HEX): {Convert.ToHexString(plainText)}");
        Console.WriteLine($"Plain text (Base64): {Convert.ToBase64String(plainText)}");

        Stopwatch stopwatch = new Stopwatch();
        stopwatch.Start();
        Console.WriteLine("Stopwatch started. Doing 10.000.000 (10 Milion!) iterations of encrypt + decrypt.");

        using (var cipher = new BlazingOpossum(key))
        {
            for (int i = 0; i < 10000000; i++)
            {
                byte[] encrypted = cipher.Encrypt(iv, plainText);

               //Console.WriteLine($"Encrypted (HEX): {Convert.ToHexString(encrypted)}");
                //Console.WriteLine($"Encrypted (Base64): {Convert.ToBase64String(encrypted)}");

                byte[] decrypted = cipher.Decrypt(iv, encrypted);
                //Console.WriteLine("Decrypted: " + Encoding.UTF8.GetString(decrypted));
            }
        }

        stopwatch.Stop();
        Console.WriteLine("Finished. Took " + stopwatch.ElapsedMilliseconds.ToString() + "ms.");
        Console.ReadLine();
    }
}
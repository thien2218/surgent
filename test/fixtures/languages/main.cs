using System;
using static System.Math;
using Text = System.Text;

Console.WriteLine("start");

static int Twice(int value) => value * 2;

namespace App
{
    public class Widget
    {
        public const int Max = 10;
        private int width, height;
        public string Name { get; set; }
        public int Area { get { return width * height; } }
        public int Perimeter => 2 * (width + height);
        public event EventHandler Changed;

        public Widget() { }

        ~Widget() { }

        public static Widget operator +(Widget left, Widget right) => left;

        public static implicit operator int(Widget widget) => widget.width;

        public int this[int index] => index;

        public void Draw()
        {
            int local = 0;
        }

        private class Part
        {
            public void Attach() { }
        }
    }

    public struct Point
    {
        public int X;
    }

    public interface IShape
    {
        int Sides { get; }
        double Area();
    }

    public record Person(string Name, int Age);

    public enum Color { Red, Green }

    public delegate void Handler(object sender);
}

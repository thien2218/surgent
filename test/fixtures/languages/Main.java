package com.example;

import java.util.List;
import java.util.function.*;
import static java.util.Collections.emptyList;

public class Main {
  public static final int MAX = 10;
  private int low, high;

  public Main() {}

  @Override
  public String toString() {
    Runnable task = new Runnable() {
      public void run() {}
    };
    return "";
  }

  static class Nested {
    void hidden() {}
  }
}

interface Shape {
  int SIDES = 0;

  double area();

  default String label() {
    return "shape";
  }
}

enum Color {
  RED(1),
  GREEN(2);

  private final int code;

  Color(int code) {
    this.code = code;
  }

  int code() {
    return code;
  }
}

record Point(int x, int y) {
  Point {
    if (x < 0) throw new IllegalArgumentException();
  }

  int sum() {
    return x + y;
  }
}

@interface Marker {
  String value();
}

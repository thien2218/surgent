#include <stdio.h>
#include "config.h"

#define BUFFER_SIZE 256
#define MAX(a, b) ((a) > (b) ? (a) : (b))
#define FEATURE

typedef unsigned int uint;

typedef struct Point {
  int x, y;
} Point;

typedef struct {
  double width;
} Size;

struct node {
  int value;
  struct node *next;
  void (*visit)(struct node *);
  unsigned flags : 3;
  union {
    int id;
    char tag;
  };
};

union number {
  int i;
  float f;
};

enum color { RED, GREEN };

int counter = 0;
static const char *name = "main";
void (*on_exit)(int);

int helper(int value);
int external(void);

#ifdef DEBUG
void trace(void) {}
#endif

int helper(int value) {
  int doubled = value * 2;
  return doubled;
}

char *name_of(struct node *item) {
  return 0;
}

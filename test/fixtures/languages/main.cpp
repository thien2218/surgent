#include <functional>
#include <string>

using namespace std;
using std::string;
namespace fs = std::filesystem;

#define LOG(message) puts(message)

using Id = int;
typedef unsigned long Size;

namespace app {

class Widget {
public:
  static constexpr int MAX = 10;
  int width = 0;
  std::function<void()> callback;

  Widget();
  ~Widget();
  void draw();
  bool operator==(const Widget &other) const;
  int area() const { return width * width; }

  class Part {
    void attach();
  };

private:
  string label;
};

Widget::Widget() {}

Widget::~Widget() {}

void Widget::draw() {}

void helper();

}  // namespace app

template <typename T>
struct Box {
  T value;
  T get() const { return value; }
  template <typename U>
  void put(U item);
};

template <typename T>
template <typename U>
void Box<T>::put(U item) {}

template <typename T>
T largest(T left, T right) {
  return left > right ? left : right;
}

union Number {
  int i;
  float f;
};

enum class Color { Red, Green };

auto add = [](int left, int right) { return left + right; };

int main() {
  int local = 0;
  return local;
}

struct Shape {
  virtual double area() const = 0;
};
